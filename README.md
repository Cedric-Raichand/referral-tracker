# Referral Tracker

Track who brings new members into your WhatsApp group, Snapchat and Instagram.

## How it works

1. A person registers with a name, phone number and username (`/`).
2. They get one personal link, for example `https://yoursite.com/r/john`.
3. A newcomer opens that link, picks WhatsApp, Snapchat or Instagram, enters their name and a contact (phone number for WhatsApp, username for the others), and is sent to the group or account.
4. The join is credited to the referrer. Each contact counts once per platform, and nobody can refer themselves.
5. You see the counts at `/admin` (password protected), with the full list of people behind each number.

> WhatsApp, Snapchat and Instagram do not tell us which link someone used, or whether the person really joined. "Referred" means they came through the link and were sent on. "Confirmed" is the admin's own check against the real member or follower list.

## Two sites, one database

The system is two separate websites that share one database:

| Site | Who uses it | Start command | Needs |
| --- | --- | --- | --- |
| **Public site** | Referrers and newcomers: registration, referral links, join pages | `npm start` | `MONGODB_URI`, `MONGODB_DB`, `BASE_URL`, `WHATSAPP_URL`, `SNAPCHAT_URL`, `INSTAGRAM_URL` |
| **Admin site** | The admin only: dashboard, Confirm buttons, bulk confirm | `npm run start:admin` | `MONGODB_URI`, `MONGODB_DB`, `ADMIN_PASSWORD` |

The public site has no admin pages at all, and the admin site has no registration or join pages. Both read and write the same MongoDB database, so every join on the public site shows up on the admin site. Give each site its own address and keep the admin address to yourself.

Locally both can share the SQLite file. Set `PORT=3000` and `ADMIN_PORT=3001` in `.env`, then run `npm start` in one terminal and `npm run start:admin` in another.

### Admin password

- The first time, log in with the `ADMIN_PASSWORD` setting.
- After logging in, the admin can open **Change password** on the dashboard and set his own password (at least 10 characters). It is stored hashed in the database, and from then on only the new password works. Everyone who was logged in with the old one is logged out.
- Five wrong tries from one address block further tries for 15 minutes.
- **If the password is forgotten:** in MongoDB Atlas open the `settings` collection of the database and delete the `admin_password` record. The `ADMIN_PASSWORD` setting works again, and he can set a new password after logging in.

## Run it

Requires Node.js 22.13 or newer.

```bash
cp .env.example .env   # then edit it
npm start
npm test
```

## Where the data is stored

- **Local file (default):** leave `MONGODB_URI` empty. Data goes to a SQLite file (`DB_PATH`). No packages needed.
- **MongoDB Atlas:** set `MONGODB_URI` to your Atlas connection string, and run `npm install mongodb` once. Data then lives in Atlas, so it survives server restarts and redeploys on any host.

When using Atlas: create a database user, and under *Network Access* allow the host's IP addresses (for most hosts that means `0.0.0.0/0`). If the password has special characters, URL-encode them in the connection string.

| Variable | Purpose |
| --- | --- |
| `BASE_URL` | Public address of the site, used to build the links |
| `ADMIN_PASSWORD` | Password for the admin site (any username works). Only the admin site needs it |
| `PORT`, `ADMIN_PORT` | Local ports for the public and admin sites. Hosts set `PORT` for you |
| `WHATSAPP_URL`, `SNAPCHAT_URL`, `INSTAGRAM_URL` | Where newcomers are sent. Leave one empty to switch that platform off |
| `MONGODB_URI` | MongoDB Atlas connection string. Leave empty to use the local file |
| `MONGODB_DB` | Database name inside MongoDB (default `referral_tracker`) |
| `DB_PATH` | SQLite file location, used only when `MONGODB_URI` is empty (default `data/referrals.db`) |

## Routes

Public site:

| Route | What it does |
| --- | --- |
| `GET /` | Registration form |
| `GET /links/:username` | A referrer's single link to share |
| `GET /r/:username` | Newcomer picks where to join (WhatsApp, Snapchat, Instagram) |
| `GET/POST /r/:username/:platform` | Join form, records the referral, sends the person on |

Admin site (every page except the login needs the admin to be logged in):

| Route | What it does |
| --- | --- |
| `GET/POST /login`, `POST /logout` | Admin login and logout |
| `GET/POST /admin/password` | Change the admin password |
| `GET /admin`, `/admin/:username` | Dashboard and per-referrer list with Confirm buttons |
| `POST /admin/confirm` | Confirm or undo one referred person |
| `GET/POST /admin/bulk` | Paste the WhatsApp member list to confirm matching numbers |
