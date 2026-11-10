#!/usr/bin/env python3
"""
MusafirMate — zero-dependency server.
Run:   python server.py
Open:  http://localhost:3000
"""
import json, os, re, secrets, hashlib, mimetypes, base64, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(ROOT, "public")
DB_PATH = os.path.join(ROOT, "data", "db.json")
PORT = int(os.environ.get("PORT", 3000))

VIBES = ["Backpacking", "Budget", "Foodie", "Trekking", "Road trip", "Luxury", "Culture", "Beach"]
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
DATAURL_RE = re.compile(r"^data:image/(png|jpe?g|webp|gif);base64,(.+)$", re.DOTALL)
ALLOWED_IMAGE_EXT = {"png", "jpeg", "jpg", "webp", "gif"}
MAX_IMAGE_BYTES = 3 * 1024 * 1024  # 3 MB decoded

_lock = threading.Lock()

def blank():
    return {"users": [], "trips": [], "requests": [], "messages": [], "sessions": [], "reports": []}

def load_db():
    try:
        with open(DB_PATH, encoding="utf-8") as f:
            raw = json.load(f)
        d = blank()
        for k in d:
            if isinstance(raw.get(k), list):
                d[k] = raw[k]
        return d
    except Exception:
        return blank()

db = load_db()

def save():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    tmp = DB_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(db, f, indent=2, ensure_ascii=False)
    os.replace(tmp, DB_PATH)

def now():
    return datetime.now(timezone.utc).isoformat()

def today_iso():
    return datetime.now(timezone.utc).date().isoformat()

def newid():
    return secrets.token_hex(8)

def text(v, limit=500):
    return "" if v is None else str(v).strip()[:limit]

def hash_password(pw):
    salt = secrets.token_hex(16)
    h = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1, dklen=64).hex()
    return salt + ":" + h

def verify_password(pw, stored):
    try:
        salt, h = str(stored).split(":")
        test = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1, dklen=64).hex()
        return secrets.compare_digest(test, h)
    except Exception:
        return False

# ---------- image uploads ----------

def save_data_url(data_url, subdir):
    """Decode a data:image base64 URL, save it under public/uploads/<subdir>, return URL path or None."""
    if not isinstance(data_url, str):
        return None
    m = DATAURL_RE.match(data_url.strip())
    if not m:
        return None
    ext = m.group(1).lower()
    if ext == "jpeg":
        ext = "jpg"
    if ext not in ALLOWED_IMAGE_EXT:
        return None
    try:
        raw = base64.b64decode(m.group(2), validate=True)
    except Exception:
        return None
    if len(raw) > MAX_IMAGE_BYTES:
        return None
    fname = newid() + "." + ext
    folder = os.path.join(PUBLIC, "uploads", subdir)
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, fname), "wb") as f:
        f.write(raw)
    return "/uploads/" + subdir + "/" + fname

# ---------- domain helpers ----------

def find_user(uid):
    return next((u for u in db["users"] if u["id"] == uid), None)

def find_trip(tid):
    return next((t for t in db["trips"] if t["id"] == tid), None)

def is_trip_completed(t):
    return bool(t.get("endDate")) and t["endDate"] < today_iso()

def can_chat(trip, user):
    if not user:
        return False
    if trip["ownerId"] == user["id"]:
        return True
    return any(r["tripId"] == trip["id"] and r["userId"] == user["id"] and r["status"] == "accepted"
               for r in db["requests"])

def user_feedback_received(uid):
    count = 0
    ratings = []
    for t in db["trips"]:
        for fb in t.get("feedback", []):
            if fb.get("aboutUserId") == uid:
                ratings.append(fb.get("rating", 0))
                if fb.get("rating", 0) >= 4:
                    count += 1
    avg = (sum(ratings) / len(ratings)) if ratings else 0
    return count, avg

def trust_score(u):
    if not u:
        return 0
    score = 0
    if u.get("avatar"): score += 15
    if u.get("city"): score += 10
    if u.get("bio"): score += 10
    if u.get("languages"): score += 5

    hosted_done = sum(1 for t in db["trips"] if t["ownerId"] == u["id"] and is_trip_completed(t))
    score += min(hosted_done * 10, 30)

    joined_done = sum(
        1 for t in db["trips"]
        if is_trip_completed(t) and any(
            r["tripId"] == t["id"] and r["userId"] == u["id"] and r["status"] == "accepted"
            for r in db["requests"]
        )
    )
    score += min(joined_done * 5, 20)

    positive, _ = user_feedback_received(u["id"])
    score += min(positive * 5, 10)

    return min(score, 100)

def trust_level(score):
    if score >= 86: return "Elite"
    if score >= 61: return "Trusted"
    if score >= 31: return "Verified"
    return "New"

def public_user(u, include_private=False):
    if not u:
        return None
    score = trust_score(u)
    out = {
        "id": u["id"], "name": u["name"],
        "city": u.get("city", ""), "bio": u.get("bio", ""),
        "languages": u.get("languages", ""), "style": u.get("style", ""),
        "avatar": u.get("avatar", ""),
        "memberSince": u.get("createdAt", ""),
        "tripsHosted": sum(1 for t in db["trips"] if t["ownerId"] == u["id"]),
        "trustScore": score,
        "trustLevel": trust_level(score),
    }
    if include_private:
        out["email"] = u["email"]
        out["emergencyContact"] = u.get("emergencyContact", "")
    return out

def trip_summary(trip, user):
    out = dict(trip)
    out["owner"] = public_user(find_user(trip["ownerId"]))
    accepted = [r for r in db["requests"] if r["tripId"] == trip["id"] and r["status"] == "accepted"]
    out["memberCount"] = 1 + len(accepted)
    out["isCompleted"] = is_trip_completed(trip)
    fb = trip.get("feedback", [])
    out["feedbackCount"] = len(fb)
    out["avgRating"] = round(sum(f.get("rating", 0) for f in fb) / len(fb), 1) if fb else 0
    mine = next((r for r in db["requests"]
                 if r["tripId"] == trip["id"] and user and r["userId"] == user["id"]), None)
    out["myRequest"] = mine["status"] if mine else None
    return out

# ---------- HTTP handler ----------

class Handler(BaseHTTPRequestHandler):
    server_version = "MusafirMate/1.1"

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8") or "{}")
        except Exception:
            return {}

    def cookies(self):
        out = {}
        for part in (self.headers.get("Cookie") or "").split(";"):
            if "=" in part:
                k, v = part.split("=", 1)
                out[k.strip()] = unquote(v.strip())
        return out

    def current_user(self):
        sid = self.cookies().get("sid")
        if not sid:
            return None
        sess = next((s for s in db["sessions"] if s["token"] == sid), None)
        return find_user(sess["userId"]) if sess else None

    def start_session(self, user_id):
        token = newid() + newid()
        db["sessions"].append({"token": token, "userId": user_id, "createdAt": now()})
        save()
        return "sid=%s; HttpOnly; Path=/; SameSite=Lax; Max-Age=%d" % (token, 60 * 60 * 24 * 30)

    def send_json(self, obj, status=200, cookie=None):
        payload = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self): self.dispatch("GET")
    def do_POST(self): self.dispatch("POST")
    def do_PATCH(self): self.dispatch("PATCH")
    def do_DELETE(self): self.dispatch("DELETE")

    def dispatch(self, method):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api"):
            with _lock:
                try:
                    self.handle_api(method, parsed.path[4:] or "/", parse_qs(parsed.query))
                except Exception as e:
                    self.send_json({"error": "Server error: %s" % e}, 500)
        else:
            self.serve_static(parsed.path)

    def serve_static(self, path):
        rel = "index.html" if path in ("", "/") else unquote(path.lstrip("/"))
        full = os.path.normpath(os.path.join(PUBLIC, rel))
        if not (full == PUBLIC or full.startswith(PUBLIC + os.sep)):
            return self.send_error(403)
        if os.path.isdir(full):
            full = os.path.join(full, "index.html")
        if not os.path.isfile(full):
            full = os.path.join(PUBLIC, "index.html")
            if not os.path.isfile(full):
                return self.send_error(404)
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # ---- routing ----

    def handle_api(self, method, path, q):
        parts = [p for p in path.split("/") if p]

        if method == "POST" and path == "/auth/signup": return self.signup()
        if method == "POST" and path == "/auth/login": return self.login()
        if method == "POST" and path == "/auth/logout": return self.logout()

        if method == "GET" and path == "/stats": return self.stats()

        if method == "GET" and path == "/me": return self.get_me()
        if method == "PATCH" and path == "/me": return self.update_me()
        if method == "POST" and path == "/me/avatar": return self.upload_avatar()
        if method == "DELETE" and path == "/me/avatar": return self.remove_avatar()

        if method == "GET" and path == "/trips": return self.list_trips(q)
        if method == "POST" and path == "/trips": return self.create_trip()

        if len(parts) == 2 and parts[0] == "trips":
            if method == "GET": return self.get_trip(parts[1])
            if method == "DELETE": return self.delete_trip(parts[1])

        if len(parts) == 3 and parts[0] == "trips" and parts[2] == "requests" and method == "POST":
            return self.create_request(parts[1])

        if len(parts) == 3 and parts[0] == "trips" and parts[2] == "messages":
            if method == "GET": return self.list_messages(parts[1])
            if method == "POST": return self.post_message(parts[1])

        if len(parts) == 3 and parts[0] == "trips" and parts[2] == "feedback":
            if method == "GET": return self.list_feedback(parts[1])
            if method == "POST": return self.add_feedback(parts[1])

        if method == "GET" and path == "/requests": return self.list_requests()
        if len(parts) == 3 and parts[0] == "requests" and method == "POST" and parts[2] in ("accept", "decline"):
            return self.act_request(parts[1], parts[2])

        if len(parts) == 3 and parts[0] == "users" and parts[2] == "report" and method == "POST":
            return self.report_user(parts[1])

        return self.send_json({"error": "Not found."}, 404)

    def stats(self):
        self.send_json({
            "travelers": len(db["users"]),
            "trips": len(db["trips"]),
            "destinations": len({t["destination"].strip().lower() for t in db["trips"] if t.get("destination")}),
            "mates": sum(1 for r in db["requests"] if r["status"] == "accepted"),
        })

    # ---- auth ----

    def signup(self):
        b = self.body()
        name = text(b.get("name"), 60)
        email = text(b.get("email"), 120).lower()
        password = str(b.get("password") or "")
        if not name: return self.send_json({"error": "Name is required."}, 400)
        if not EMAIL_RE.match(email): return self.send_json({"error": "Enter a valid email."}, 400)
        if len(password) < 6: return self.send_json({"error": "Password must be at least 6 characters."}, 400)
        if any(u["email"] == email for u in db["users"]):
            return self.send_json({"error": "That email is already registered."}, 400)

        user = {
            "id": newid(), "name": name, "email": email,
            "passwordHash": hash_password(password),
            "city": text(b.get("city"), 60),
            "bio": text(b.get("bio"), 400),
            "languages": text(b.get("languages"), 120),
            "style": text(b.get("style"), 40),
            "emergencyContact": text(b.get("emergencyContact"), 120),
            "avatar": "",
            "createdAt": now(),
        }
        db["users"].append(user)
        save()
        self.send_json({"user": public_user(user, include_private=True)}, 201, self.start_session(user["id"]))

    def login(self):
        b = self.body()
        email = text(b.get("email"), 120).lower()
        user = next((u for u in db["users"] if u["email"] == email), None)
        if not user or not verify_password(str(b.get("password") or ""), user.get("passwordHash")):
            return self.send_json({"error": "Wrong email or password."}, 400)
        self.send_json({"user": public_user(user, include_private=True)},
                       200, self.start_session(user["id"]))

    def logout(self):
        sid = self.cookies().get("sid")
        if sid:
            db["sessions"] = [s for s in db["sessions"] if s["token"] != sid]
            save()
        self.send_json({"ok": True}, 200, "sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0")

    def get_me(self):
        u = self.current_user()
        self.send_json({"user": public_user(u, include_private=True) if u else None})

    def update_me(self):
        user = self.current_user()
        if not user: return self.send_json({"error": "Please log in."}, 401)
        b = self.body()
        if b.get("name") is not None:
            user["name"] = text(b["name"], 60) or user["name"]
        for f, limit in (("city", 60), ("bio", 400), ("languages", 120), ("style", 40), ("emergencyContact", 120)):
            if b.get(f) is not None:
                user[f] = text(b[f], limit)
        save()
        self.send_json({"user": public_user(user, include_private=True)})

    def upload_avatar(self):
        user = self.current_user()
        if not user: return self.send_json({"error": "Please log in."}, 401)
        path = save_data_url(self.body().get("dataUrl"), "avatars")
        if not path:
            return self.send_json({"error": "Invalid image (PNG/JPG/WebP/GIF, max 3 MB)."}, 400)
        user["avatar"] = path
        save()
        self.send_json({"user": public_user(user, include_private=True)})
    def remove_avatar(self):
        user = self.current_user()
        if not user: return self.send_json({"error": "Please log in."}, 401)
        user["avatar"] = ""
        save()
        self.send_json({"user": public_user(user, include_private=True)})

    # ---- trips ----

    def list_trips(self, q):
        user = self.current_user()
        needle = (q.get("q", [""])[0] or "").strip().lower()
        vibe = (q.get("vibe", [""])[0] or "").strip()
        mine = q.get("mine", [""])[0] == "1"
        trips = sorted(db["trips"], key=lambda t: t["createdAt"], reverse=True)
        if mine and user:
            trips = [t for t in trips if t["ownerId"] == user["id"]]
        if needle:
            trips = [t for t in trips if needle in (t.get("destination", "") + " " + t.get("from", "")).lower()]
        if vibe:
            trips = [t for t in trips if t.get("vibe") == vibe]
        self.send_json([trip_summary(t, user) for t in trips])

    def create_trip(self):
        user = self.current_user()
        if not user: return self.send_json({"error": "Please log in."}, 401)
        b = self.body()
        destination = text(b.get("destination"), 80)
        start_date = text(b.get("startDate"), 10)
        end_date = text(b.get("endDate"), 10)
        if not destination: return self.send_json({"error": "Destination is required."}, 400)
        if not DATE_RE.match(start_date) or not DATE_RE.match(end_date):
            return self.send_json({"error": "Start and end dates are required."}, 400)
        if end_date < start_date:
            return self.send_json({"error": "End date must be after the start date."}, 400)
        try:
            max_mates = int(b.get("maxMates") or 3)
        except (TypeError, ValueError):
            max_mates = 3
        max_mates = min(max(max_mates, 1), 10)
        trip = {
            "id": newid(), "ownerId": user["id"],
            "from": text(b.get("from"), 80), "destination": destination,
            "startDate": start_date, "endDate": end_date,
            "budget": text(b.get("budget"), 40),
            "vibe": b.get("vibe") if b.get("vibe") in VIBES else VIBES[0],
            "description": text(b.get("description"), 1000),
            "maxMates": max_mates, "createdAt": now(),
            "feedback": [],
        }
        db["trips"].append(trip)
        save()
        self.send_json(trip_summary(trip, user), 201)

    def get_trip(self, tid):
        user = self.current_user()
        trip = find_trip(tid)
        if not trip: return self.send_json({"error": "Trip not found."}, 404)

        members = [public_user(find_user(r["userId"])) for r in db["requests"]
                   if r["tripId"] == trip["id"] and r["status"] == "accepted"]
        members = [m for m in members if m]
        mine = next((r for r in db["requests"]
                     if r["tripId"] == trip["id"] and user and r["userId"] == user["id"]), None)

        contacts = {}
        safety_contacts = {}
        if can_chat(trip, user):
            owner = find_user(trip["ownerId"])
            if owner:
                contacts[trip["ownerId"]] = owner["email"]
                if owner.get("emergencyContact"):
                    safety_contacts[owner["name"]] = owner["emergencyContact"]
            for r in db["requests"]:
                if r["tripId"] == trip["id"] and r["status"] == "accepted":
                    m = find_user(r["userId"])
                    if m:
                        contacts[m["id"]] = m["email"]
                        if m.get("emergencyContact"):
                            safety_contacts[m["name"]] = m["emergencyContact"]

        fb = trip.get("feedback", [])
        feedback = [{
            **f,
            "user": public_user(find_user(f["userId"])),
        } for f in fb]
        my_fb = user and any(f["userId"] == user["id"] for f in fb)

        out = dict(trip)
        out.update({
            "owner": public_user(find_user(trip["ownerId"])),
            "members": members,
            "memberCount": 1 + len(members),
            "myRequest": mine["status"] if mine else None,
            "isOwner": bool(user and trip["ownerId"] == user["id"]),
            "canChat": can_chat(trip, user),
            "isCompleted": is_trip_completed(trip),
            "contacts": contacts,
            "safetyContacts": safety_contacts,
            "feedback": feedback,
            "myFeedback": bool(my_fb),
        })
        self.send_json(out)

    def delete_trip(self, tid):
        user = self.current_user()
        if not user: return self.send_json({"error": "Please log in."}, 401)
        trip = find_trip(tid)
        if not trip: return self.send_json({"error": "Trip not found."}, 404)
        if trip["ownerId"] != user["id"]:
            return self.send_json({"error": "Only the host can delete this trip."}, 403)
        db["trips"] = [t for t in db["trips"] if t["id"] != tid]
        db["requests"] = [r for r in db["requests"] if r["tripId"] != tid]
        db["messages"] = [m for m in db["messages"] if m["tripId"] != tid]
        save()
        self.send_json({"ok": True})

    # ---- requests ----

    def create_request(self, tid):
        user = self.current_user()
        if not user: return self.send_json({"error": "Please log in."}, 401)
        trip = find_trip(tid)
        if not trip: return self.send_json({"error": "Trip not found."}, 404)
        if trip["ownerId"] == user["id"]:
            return self.send_json({"error": "You can't request your own trip."}, 400)
        existing = next((r for r in db["requests"]
                         if r["tripId"] == tid and r["userId"] == user["id"]), None)
        if existing and existing["status"] != "declined":
            return self.send_json({"error": "You already have a request on this trip."}, 400)
        if existing:
            existing["status"] = "pending"
            existing["createdAt"] = now()
        else:
            db["requests"].append({"id": newid(), "tripId": tid, "userId": user["id"],
                                   "status": "pending", "createdAt": now()})
        save()
        self.send_json({"ok": True}, 201)

    def list_requests(self):
        user = self.current_user()
        if not user: return self.send_json({"error": "Please log in."}, 401)
        my_trip_ids = [t["id"] for t in db["trips"] if t["ownerId"] == user["id"]]
        incoming = []
        for r in db["requests"]:
            if r["tripId"] in my_trip_ids:
                trip = find_trip(r["tripId"])
                req_user = find_user(r["userId"])
                incoming.append({**r,
                                 "trip": trip_summary(trip, user) if trip else None,
                                 "user": public_user(req_user, include_private=True) if req_user else None})
        outgoing = []
        for r in db["requests"]:
            if r["userId"] == user["id"]:
                trip = find_trip(r["tripId"])
                outgoing.append({**r, "trip": trip_summary(trip, user) if trip else None})
        self.send_json({"incoming": incoming, "outgoing": outgoing})

    def act_request(self, rid, action):
        user = self.current_user()
        if not user: return self.send_json({"error": "Please log in."}, 401)
        req = next((r for r in db["requests"] if r["id"] == rid), None)
        if not req: return self.send_json({"error": "Request not found."}, 404)
        trip = find_trip(req["tripId"])
        if not trip or trip["ownerId"] != user["id"]:
            return self.send_json({"error": "Only the trip host can do that."}, 403)
        if action == "accept":
            if req["status"] != "accepted":
                accepted = sum(1 for r in db["requests"]
                               if r["tripId"] == trip["id"] and r["status"] == "accepted")
                if accepted >= trip["maxMates"]:
                    return self.send_json({"error": "This trip is already full."}, 400)
                req["status"] = "accepted"
        else:
            req["status"] = "declined"
        save()
        self.send_json({"ok": True})

    # ---- chat ----

    def list_messages(self, tid):
        user = self.current_user()
        if not user: return self.send_json({"error": "Please log in."}, 401)
        trip = find_trip(tid)
        if not trip: return self.send_json({"error": "Trip not found."}, 404)
        if not can_chat(trip, user):
            return self.send_json({"error": "You're not part of this trip."}, 403)
        msgs = sorted((m for m in db["messages"] if m["tripId"] == tid), key=lambda m: m["createdAt"])
        self.send_json([{**m, "user": public_user(find_user(m["userId"]))} for m in msgs])

    def post_message(self, tid):
        user = self.current_user()
        if not user: return self.send_json({"error": "Please log in."}, 401)
        trip = find_trip(tid)
        if not trip: return self.send_json({"error": "Trip not found."}, 404)
        if not can_chat(trip, user):
            return self.send_json({"error": "You're not part of this trip."}, 403)
        msg_text = text(self.body().get("text"), 1000)
        if not msg_text: return self.send_json({"error": "Message is empty."}, 400)
        msg = {"id": newid(), "tripId": tid, "userId": user["id"],
               "text": msg_text, "createdAt": now()}
        db["messages"].append(msg)
        save()
        self.send_json(msg, 201)

    # ---- feedback ----

    def list_feedback(self, tid):
        trip = find_trip(tid)
        if not trip: return self.send_json({"error": "Trip not found."}, 404)
        fb = trip.get("feedback", [])
        self.send_json([{**f, "user": public_user(find_user(f["userId"]))} for f in fb])

    def add_feedback(self, tid):
        user = self.current_user()
        if not user: return self.send_json({"error": "Please log in."}, 401)
        trip = find_trip(tid)
        if not trip: return self.send_json({"error": "Trip not found."}, 404)
        if not can_chat(trip, user):
            return self.send_json({"error": "Only trip members can leave feedback."}, 403)
        if not is_trip_completed(trip):
            return self.send_json({"error": "You can only leave feedback after the trip ends."}, 400)
        fb_list = trip.setdefault("feedback", [])
        if any(f["userId"] == user["id"] for f in fb_list):
            return self.send_json({"error": "You already left feedback for this trip."}, 400)

        b = self.body()
        try:
            rating = int(b.get("rating") or 0)
        except (TypeError, ValueError):
            rating = 0
        if rating < 1 or rating > 5:
            return self.send_json({"error": "Rating must be 1–5."}, 400)
        fb_text = text(b.get("text"), 1000)
        if not fb_text:
            return self.send_json({"error": "Tell us how the trip felt."}, 400)

        photos = b.get("photos") or []
        if not isinstance(photos, list):
            photos = []
        saved = []
        for p in photos[:4]:
            path = save_data_url(p, "feedback")
            if path:
                saved.append(path)

        entry = {
            "id": newid(),
            "userId": user["id"],
            "rating": rating,
            "text": fb_text,
            "photos": saved,
            "createdAt": now(),
        }
        fb_list.append(entry)
        save()
        self.send_json({**entry, "user": public_user(user)}, 201)

    # ---- report ----

    def report_user(self, target_id):
        user = self.current_user()
        if not user: return self.send_json({"error": "Please log in."}, 401)
        if target_id == user["id"]:
            return self.send_json({"error": "You can't report yourself."}, 400)
        target = find_user(target_id)
        if not target: return self.send_json({"error": "User not found."}, 404)
        reason = text(self.body().get("reason"), 500)
        db["reports"].append({
            "id": newid(), "byId": user["id"], "targetId": target_id,
            "reason": reason, "createdAt": now(),
        })
        save()
        self.send_json({"ok": True})


def main():
    if not os.path.isdir(PUBLIC):
        print("ERROR: public/ folder not found next to server.py")
        return
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("\n  MusafirMate running → http://localhost:%d\n  Ctrl+C to stop.\n" % PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nBye.")

if __name__ == "__main__":
    main()