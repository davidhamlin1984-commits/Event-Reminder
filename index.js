const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  InteractionType,
  ModalBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');

dotenv.config();

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const ALERT_CHANNEL_ID = process.env.ALERT_CHANNEL_ID;
const SCHEDULER_ROLE_NAME = process.env.EVENT_SCHEDULER_ROLE_NAME || process.env.SCHEDULER_ROLE_NAME || 'Event Scheduler';
const EVENTS_ENV = process.env.EVENTS || 'Bear Hunt,Foundry,Canyon,Sunfire,Mercenary Prestige';
const ALLIANCE_ROLES_ENV = process.env.ALLIANCE_ROLES || 'ZRH:123,VIK:456';
const DATA_DIR = process.env.DATA_DIR || __dirname;

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !ALERT_CHANNEL_ID) {
  console.error('Missing required environment variables. Check your .env / Railway variables.');
  process.exit(1);
}

const remindersPath = path.join(DATA_DIR, 'reminders.json');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const setupSessions = new Map();

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function ensureRemindersFile() {
  ensureDataDir();
  if (!fs.existsSync(remindersPath)) {
    fs.writeFileSync(remindersPath, '[]', 'utf8');
  }
}

function loadReminders() {
  ensureRemindersFile();
  try {
    return JSON.parse(fs.readFileSync(remindersPath, 'utf8'));
  } catch (error) {
    console.error('Failed to read reminders.json', error);
    return [];
  }
}

function saveReminders(reminders) {
  ensureRemindersFile();
  fs.writeFileSync(remindersPath, JSON.stringify(reminders, null, 2), 'utf8');
}

function loadEvents() {
  return EVENTS_ENV.split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 25);
}

function loadAllianceRoles() {
  const map = {};
  for (const pair of ALLIANCE_ROLES_ENV.split(',')) {
    const [nameRaw, roleIdRaw] = pair.split(':');
    const name = (nameRaw || '').trim().toUpperCase();
    const roleId = (roleIdRaw || '').trim();
    if (name && roleId) {
      map[name] = roleId;
    }
  }
  return map;
}

function hasSchedulerRole(member) {
  return member?.roles?.cache?.some((role) => role.name === SCHEDULER_ROLE_NAME);
}

function makeId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseUtcDateTime(dateStr, timeStr) {
  const dateMatch = (dateStr || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = (timeStr || '').trim().match(/^(\d{2}):(\d{2})$/);

  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

const now = new Date(Date.now() + 10 * 60 * 1000); // +10 min safer

const defaultDate = now.toISOString().slice(0, 10);
const defaultTime = now.toISOString().slice(11, 16);

const modal = new ModalBuilder()
  .setCustomId('scheduler:time_modal')
  .setTitle('Enter Event Time');

const dateInput = new TextInputBuilder()
  .setCustomId('event_date_utc')
  .setLabel('UTC Date')
  .setStyle(TextInputStyle.Short)
  .setRequired(true)
  .setValue(defaultDate);

const timeInput = new TextInputBuilder()
  .setCustomId('event_time_utc')

function makeDiscordTimestamp(date) {
  return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
}

function buildMainPanel() {
  const embed = new EmbedBuilder()
    .setTitle('Event Scheduler Panel')
    .setDescription(
      [
        'Create and manage alliance event reminders.',
        `Only members with the **${SCHEDULER_ROLE_NAME}** role can use these controls.`,
        'All times are entered and stored in **UTC**.',
      ].join('\n')
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('scheduler:create')
      .setLabel('Create Event Reminder')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('scheduler:list')
      .setLabel('View Active Reminders')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('scheduler:delete')
      .setLabel('Delete Reminder')
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row] };
}

function buildEventSelect() {
  const options = loadEvents().map((eventName) => ({
    label: eventName.slice(0, 100),
    value: eventName,
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId('scheduler:event_select')
    .setPlaceholder('Select an event')
    .addOptions(options);

  return new ActionRowBuilder().addComponents(select);
}

function buildAllianceSelect() {
  const alliances = Object.keys(loadAllianceRoles());

  const options = alliances.map((alliance) => ({
    label: alliance.slice(0, 100),
    value: alliance,
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId('scheduler:alliance_select')
    .setPlaceholder('Select an alliance')
    .addOptions(options);

  return new ActionRowBuilder().addComponents(select);
}

function buildFrequencySelect() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('scheduler:frequency_select')
    .setPlaceholder('Choose frequency')
    .addOptions(
      {
        label: 'One Off',
        value: 'one_off',
        description: 'Single occurrence',
      },
      {
        label: 'Repeat every X hours',
        value: 'repeat_hours',
        description: 'Repeats forever until deleted',
      }
    );

  return new ActionRowBuilder().addComponents(select);
}

function buildDeleteSelect(reminders) {
  const active = reminders.filter((r) => r.active).slice(0, 25);

  const select = new StringSelectMenuBuilder()
    .setCustomId('scheduler:delete_select')
    .setPlaceholder('Select a reminder to delete')
    .addOptions(
      active.map((r) => ({
        label: r.eventName.slice(0, 100),
        value: r.id,
        description: `${r.alliance} | ${formatUtc(new Date(r.nextEventTime))}`.slice(0, 100),
      }))
    );

  return new ActionRowBuilder().addComponents(select);
}

function getReminderSummary(reminder) {
  const frequencyText =
    reminder.frequencyType === 'one_off'
      ? 'One Off'
      : `Every ${reminder.repeatHours} hours`;

  return [
    `**Event:** ${reminder.eventName}`,
    `**Alliance:** ${reminder.alliance}`,
    `**Next Event Time:** ${formatUtc(new Date(reminder.nextEventTime))}`,
    `**Local View:** ${makeDiscordTimestamp(new Date(reminder.nextEventTime))}`,
    `**Frequency:** ${frequencyText}`,
    `**Alert Channel:** <#${reminder.alertChannelId}>`,
    `**Ping Role:** ${reminder.pingRoleId ? `<@&${reminder.pingRoleId}>` : 'None'}`,
  ].join('\n');
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('post-scheduler-panel')
      .setDescription('Post the event scheduler control panel.'),
  ].map((command) => command.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: commands,
  });
  console.log('Slash commands registered.');
}

async function sendReminderMessage(reminder, leadText) {
  try {
    const channel = await client.channels.fetch(reminder.alertChannelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      console.warn(`Alert channel ${reminder.alertChannelId} not found or not a text channel.`);
      return;
    }

    const eventDate = new Date(reminder.nextEventTime);
    const mention = reminder.pingRoleId ? `<@&${reminder.pingRoleId}> ` : '';

    const content =
      `${mention}**${reminder.eventName}** for **${reminder.alliance}** starts ${leadText}.\n` +
      `Event time: ${formatUtc(eventDate)}\n` +
      `Local time: ${makeDiscordTimestamp(eventDate)}`;

    await channel.send({
      content,
      allowedMentions: reminder.pingRoleId
        ? { roles: [reminder.pingRoleId] }
        : { parse: [] },
    });
  } catch (error) {
    console.error('Failed to send reminder message', error);
  }
}

async function schedulerTick() {
  const reminders = loadReminders();
  const now = new Date();
  let changed = false;

  for (const reminder of reminders) {
    if (!reminder.active) continue;

    const eventTime = new Date(reminder.nextEventTime);
    const msUntil = eventTime.getTime() - now.getTime();

    if (!reminder.sent1Hour && msUntil <= 60 * 60 * 1000 && msUntil > 50 * 60 * 1000) {
      await sendReminderMessage(reminder, 'in **1 hour**');
      reminder.sent1Hour = true;
      changed = true;
    }

    if (!reminder.sent10Min && msUntil <= 10 * 60 * 1000 && msUntil > 0) {
      await sendReminderMessage(reminder, 'in **10 minutes**');
      reminder.sent10Min = true;
      changed = true;
    }

    if (msUntil <= 0) {
      if (
        reminder.frequencyType === 'repeat_hours' &&
        Number.isFinite(reminder.repeatHours) &&
        reminder.repeatHours > 0
      ) {
        let nextTime = eventTime;
        while (nextTime.getTime() <= now.getTime()) {
          nextTime = new Date(
            nextTime.getTime() + reminder.repeatHours * 60 * 60 * 1000
          );
        }
        reminder.nextEventTime = nextTime.toISOString();
        reminder.sent1Hour = false;
        reminder.sent10Min = false;
        changed = true;
      } else {
        reminder.active = false;
        changed = true;
      }
    }
  }

  if (changed) {
    saveReminders(reminders);
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  setInterval(() => {
    schedulerTick().catch((error) => console.error('Scheduler tick failed', error));
  }, 30 * 1000);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'post-scheduler-panel') {
        if (!hasSchedulerRole(interaction.member)) {
          await interaction.reply({
            content: `You need the **${SCHEDULER_ROLE_NAME}** role to use this command.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.reply(buildMainPanel());
      }
      return;
    }

    if (interaction.isButton()) {
      if (!hasSchedulerRole(interaction.member)) {
        await interaction.reply({
          content: `You need the **${SCHEDULER_ROLE_NAME}** role to use this.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (interaction.customId === 'scheduler:create') {
        setupSessions.set(interaction.user.id, {
          step: 'event',
          userId: interaction.user.id,
          guildId: interaction.guildId,
        });

        await interaction.reply({
          content: 'Choose the event you want to schedule.',
          components: [buildEventSelect()],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (interaction.customId === 'scheduler:list') {
        const reminders = loadReminders().filter((r) => r.active);

        if (!reminders.length) {
          await interaction.reply({
            content: 'There are no active reminders.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const chunks = [];
        let current = '';

        for (let i = 0; i < reminders.length; i++) {
          const block = `### ${i + 1}\n${getReminderSummary(reminders[i])}\n\n`;
          if ((current + block).length > 3800) {
            chunks.push(current);
            current = block;
          } else {
            current += block;
          }
        }
        if (current) chunks.push(current);

        const embed = new EmbedBuilder()
          .setTitle('Active Reminders')
          .setDescription(chunks[0] || 'No reminders.');

        await interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (interaction.customId === 'scheduler:delete') {
        const reminders = loadReminders().filter((r) => r.active);

        if (!reminders.length) {
          await interaction.reply({
            content: 'There are no active reminders to delete.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.reply({
          content: 'Select a reminder to delete.',
          components: [buildDeleteSelect(reminders)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (!hasSchedulerRole(interaction.member)) {
        await interaction.reply({
          content: `You need the **${SCHEDULER_ROLE_NAME}** role to use this.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (interaction.customId === 'scheduler:event_select') {
        const selected = interaction.values[0];
        const session = setupSessions.get(interaction.user.id) || {};

        session.eventName = selected;
        session.step = 'alliance';
        setupSessions.set(interaction.user.id, session);

        await interaction.update({
          content: `Event selected: **${selected}**\nNow choose the alliance.`,
          components: [buildAllianceSelect()],
        });
        return;
      }

      if (interaction.customId === 'scheduler:alliance_select') {
        const selected = interaction.values[0];
        const session = setupSessions.get(interaction.user.id);

        if (!session) {
          await interaction.reply({
            content: 'Your setup session expired. Please start again.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        session.alliance = selected;
        session.pingRoleId = loadAllianceRoles()[selected] || null;
        session.step = 'frequency';
        setupSessions.set(interaction.user.id, session);

        await interaction.update({
          content:
            `Event selected: **${session.eventName}**\n` +
            `Alliance selected: **${selected}**\n` +
            `Now choose the frequency.`,
          components: [buildFrequencySelect()],
        });
        return;
      }

      if (interaction.customId === 'scheduler:frequency_select') {
        const selected = interaction.values[0];
        const session = setupSessions.get(interaction.user.id);

        if (!session) {
          await interaction.reply({
            content: 'Your setup session expired. Please start again.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        session.frequencyType = selected;
        session.step = 'datetime';
        setupSessions.set(interaction.user.id, session);

       const now = new Date();
const defaultDate = now.toISOString().slice(0, 10);
const defaultTime = now.toISOString().slice(11, 16);

const modal = new ModalBuilder()
  .setCustomId('scheduler:time_modal')
  .setTitle('Enter Event Time');

const dateInput = new TextInputBuilder()
  .setCustomId('event_date_utc')
  .setLabel('UTC Date')
  .setRequired(true)
  .setStyle(TextInputStyle.Short)
  .setValue(defaultDate)
  .setPlaceholder('YYYY-MM-DD');

const timeInput = new TextInputBuilder()
  .setCustomId('event_time_utc')
  .setLabel('UTC Time')
  .setRequired(true)
  .setStyle(TextInputStyle.Short)
  .setValue(defaultTime)
  .setPlaceholder('HH:mm');

        modal.addComponents(
          new ActionRowBuilder().addComponents(dateInput),
          new ActionRowBuilder().addComponents(timeInput)
        );

        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === 'scheduler:delete_select') {
        const reminderId = interaction.values[0];
        const reminders = loadReminders();
        const reminder = reminders.find((r) => r.id === reminderId);

        if (!reminder) {
          await interaction.update({
            content: 'Reminder not found.',
            components: [],
          });
          return;
        }

        reminder.active = false;
        saveReminders(reminders);

        await interaction.update({
          content: `Deleted reminder for **${reminder.eventName}** (${reminder.alliance}) at ${formatUtc(new Date(reminder.nextEventTime))}.`,
          components: [],
        });
        return;
      }
    }

    if (interaction.type === InteractionType.ModalSubmit) {
      if (!hasSchedulerRole(interaction.member)) {
        await interaction.reply({
          content: `You need the **${SCHEDULER_ROLE_NAME}** role to use this.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (interaction.customId === 'scheduler:time_modal') {
        const session = setupSessions.get(interaction.user.id);

        if (!session) {
          await interaction.reply({
            content: 'Your setup session expired. Please start again.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const dateRaw = interaction.fields.getTextInputValue('event_date_utc');
        const timeRaw = interaction.fields.getTextInputValue('event_time_utc');

        const parsedDate = parseUtcDateTime(dateRaw, timeRaw);
        if (!parsedDate) {
          await interaction.reply({
            content: 'Invalid UTC date/time. Use `YYYY-MM-DD` and `HH:mm`.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (parsedDate.getTime() <= Date.now()) {
          await interaction.reply({
            content: 'The event time must be in the future.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        session.eventTime = parsedDate;
        setupSessions.set(interaction.user.id, session);

        if (session.frequencyType === 'one_off') {
          const reminder = {
            id: makeId(),
            eventName: session.eventName,
            alliance: session.alliance,
            nextEventTime: session.eventTime.toISOString(),
            frequencyType: 'one_off',
            repeatHours: null,
            alertChannelId: ALERT_CHANNEL_ID,
            pingRoleId: session.pingRoleId,
            createdBy: interaction.user.id,
            active: true,
            sent1Hour: false,
            sent10Min: false,
            createdAt: new Date().toISOString(),
          };

          const reminders = loadReminders();
          reminders.push(reminder);
          saveReminders(reminders);
          setupSessions.delete(interaction.user.id);

          const embed = new EmbedBuilder()
            .setTitle('Reminder Created')
            .setDescription(getReminderSummary(reminder));

          await interaction.reply({
            embeds: [embed],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const repeatModal = new ModalBuilder()
          .setCustomId('scheduler:repeat_modal')
          .setTitle('Repeat Every X Hours');

        const hoursInput = new TextInputBuilder()
          .setCustomId('repeat_hours')
          .setLabel('Repeat every how many hours?')
          .setPlaceholder('48')
          .setRequired(true)
          .setStyle(TextInputStyle.Short);

        repeatModal.addComponents(
          new ActionRowBuilder().addComponents(hoursInput)
        );

        await interaction.showModal(repeatModal);
        return;
      }

      if (interaction.customId === 'scheduler:repeat_modal') {
        const session = setupSessions.get(interaction.user.id);

        if (!session) {
          await interaction.reply({
            content: 'Your setup session expired. Please start again.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const hoursRaw = interaction.fields.getTextInputValue('repeat_hours').trim();
        const repeatHours = Number(hoursRaw);

        if (!Number.isFinite(repeatHours) || repeatHours <= 0) {
          await interaction.reply({
            content: 'Please enter a valid number of hours greater than 0.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const reminder = {
          id: makeId(),
          eventName: session.eventName,
          alliance: session.alliance,
          nextEventTime: session.eventTime.toISOString(),
          frequencyType: 'repeat_hours',
          repeatHours,
          alertChannelId: ALERT_CHANNEL_ID,
          pingRoleId: session.pingRoleId,
          createdBy: interaction.user.id,
          active: true,
          sent1Hour: false,
          sent10Min: false,
          createdAt: new Date().toISOString(),
        };

        const reminders = loadReminders();
        reminders.push(reminder);
        saveReminders(reminders);
        setupSessions.delete(interaction.user.id);

        const embed = new EmbedBuilder()
          .setTitle('Reminder Created')
          .setDescription(getReminderSummary(reminder));

        await interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }
  } catch (error) {
    console.error('Interaction handler error', error);

    if (interaction.deferred || interaction.replied) {
      await interaction
        .followUp({
          content: 'Something went wrong while processing that action.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => null);
    } else {
      await interaction
        .reply({
          content: 'Something went wrong while processing that action.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => null);
    }
  }
});

(async () => {
  try {
    ensureRemindersFile();
    await registerCommands();
    await client.login(TOKEN);
  } catch (error) {
    console.error('Startup failed', error);
    process.exit(1);
  }
})();
