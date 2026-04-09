# Discord Event Scheduler

A Discord bot for alliance event reminders with a button-driven workflow:

- Event dropdown
- Alliance dropdown
- Frequency dropdown
- UTC date/time modal
- Repeating reminders every X hours until cancelled
- Alerts at 1 hour and 10 minutes before the event
- Railway-friendly deployment

## Requirements

- Node.js 20+
- A Discord application and bot token
- A Discord server where the bot is installed
- Railway account and GitHub repo if deploying to Railway

## Environment variables

Copy `.env.example` to `.env` and fill in the values.

- `DISCORD_TOKEN`: Bot token from Discord Developer Portal
- `CLIENT_ID`: Discord application ID
- `GUILD_ID`: Your Discord server ID
- `ALERT_CHANNEL_ID`: The channel where reminders should be posted
- `EVENT_SCHEDULER_ROLE_NAME`: Role name allowed to use the scheduler UI
- `EVENT_SCHEDULER_ROLE_ID`: Optional exact role ID instead of using name lookup
- `DATA_DIR`: Directory for `reminders.json`
- `ALLIANCE_ROLES`: Comma-separated alliance-to-role mapping, e.g. `ZRH:123,VIK:456`
- `EVENTS`: Comma-separated event labels
- `CHECK_INTERVAL_MS`: How often the scheduler checks reminders

## Local run

```bash
npm install
npm start
```

On startup the bot registers these guild slash commands:

- `/post-scheduler-panel` - posts the button panel in the current channel
- `/list-reminders` - shows active reminders

## Discord invite permissions

When generating the invite URL, include:

- `bot`
- `applications.commands`

Recommended bot permissions:

- View Channels
- Send Messages
- Embed Links
- Read Message History
- Mention Everyone

## How the flow works

1. Run `/post-scheduler-panel` in your staff channel.
2. Click **Create Event Reminder**.
3. Pick an event.
4. Pick an alliance.
5. Pick a frequency.
6. Enter UTC date and time in the modal.
7. If repeating, enter the repeat interval in hours.

The bot stores reminders in `reminders.json` and keeps repeating reminders active until you cancel them.

## Railway deployment

### 1. Push to GitHub

Create a repo and push these files.

### 2. Create Railway project

In Railway:

- New Project
- Deploy from GitHub repo
- Select your repo

### 3. Add environment variables

Add the same values from `.env` into Railway Variables.

### 4. Add a Volume

Mount a volume at `/app/data` so `reminders.json` persists across restarts.

### 5. Deploy

Railway will build and run `npm start`.

## Notes

- Time is stored and validated in UTC.
- Discord does not provide a native calendar/time picker in the standard bot UI, so the bot uses a modal for date/time entry.
- If you update the event or alliance lists, restart the bot after changing variables.
