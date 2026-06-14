import express from 'express';

import events from '../controllers/events.js';
import sync from '../controllers/sync.js';

import adminCreate from '../controllers/admin/create.js';
import adminList from '../controllers/admin/list.js';

import authGoogle from '../controllers/auth/google.js';
import authInit from '../controllers/auth/init.js';
import authLark from '../controllers/auth/lark.js';
import authStatus from '../controllers/auth/status.js';

import cronRefreshTokens from '../controllers/cron/refresh-tokens.js';
import cronSyncCalendar from '../controllers/cron/sync-calendar.js';
import resetSync from '../controllers/cron/reset-sync.js';

import driveList from '../controllers/drive/list.js';
import driveReport from '../controllers/drive/report.js';
import driveSearch from '../controllers/drive/search.js';
import driveSheet from '../controllers/drive/sheet.js';

import eventsAttendees from '../controllers/events/attendees.js';
import eventsCreate from '../controllers/events/create.js';
import eventsDelete from '../controllers/events/delete.js';
import eventsUpdate from '../controllers/events/update.js';

import larkGroups from '../controllers/lark/groups.js';
import larkMessages from '../controllers/lark/messages.js';

import tasksCreate from '../controllers/tasks/create.js';
import tasksList from '../controllers/tasks/list.js';

const app = express();

// Parse JSON bodies
app.use(express.json());

// Mount routes
app.all('/api/events', events);
app.all('/api/sync', sync);

app.all('/api/admin/create', adminCreate);
app.all('/api/admin/list', adminList);

app.all('/api/auth/google', authGoogle);
app.all('/api/auth/init', authInit);
app.all('/api/auth/lark', authLark);
app.all('/api/auth/status', authStatus);

app.all('/api/cron/refresh-tokens', cronRefreshTokens);
app.all('/api/cron/reset-sync', resetSync);
app.all('/api/cron/sync-calendar', cronSyncCalendar);

app.all('/api/drive/list', driveList);
app.all('/api/drive/report', driveReport);
app.all('/api/drive/search', driveSearch);
app.all('/api/drive/sheet', driveSheet);

app.all('/api/events/attendees', eventsAttendees);
app.all('/api/events/create', eventsCreate);
app.all('/api/events/delete', eventsDelete);
app.all('/api/events/update', eventsUpdate);

app.all('/api/lark/groups', larkGroups);
app.all('/api/lark/messages', larkMessages);

app.all('/api/tasks/create', tasksCreate);
app.all('/api/tasks/list', tasksList);

export default app;
