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
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

dotenv.config();

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const SCHEDULER_ROLE_NAME = process.env.SCHEDULER_ROLE_NAME || 'Event Scheduler';
const ALERT_CHANNEL_ID = process.env.ALERT_CHANNEL_ID;
const PING_ROLE_ID = process.env.PING_ROLE_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !ALERT_CHANNEL_ID) {
  console.error('Missing required environment variables. Check your .env file.');
  process.exit(1);
}

const appDir = __dirname;
const remindersPath = path.join(appDir, 'reminders.json');
const eventsPath = path.join(appDir, 'events.json');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const setupSessions = new Map();

function loadEvents() {
  try {
    return JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
  } catch (error) {
    console.error('Failed to load events.json', error);
    return ['Custom Event'];
  }
}

function ensureRemindersFile() {
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
  fs.writeFileSync(remindersPath, JSON.stringify(reminders, null, 2), 'utf8');
}

function hasSchedulerRole(member) {
  return member.roles.cache.some((role) => role.name === SCHEDULER_ROLE_NAME);
}

function makeId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseUtcInput(input) {
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute
  ) {
    return null;
  }

  return date;
}

function formatUtc(date) {
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function makeDiscordTimestamp(date) {
  return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
}

function buildMainPanel() {
  const embed = new EmbedBuilder()
    .setTitle('Event Scheduler Panel')
    .setDescription([
      'Create and manage alliance event reminders.',
      `Only members with the **${SCHEDULER_ROLE_NAME}** role can use these controls.`,
      'All times are entered and stored in **UTC**.',
    ].join('\n'));

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
      .setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row] };
}

function buildEventSelect() {
  const events = loadEvents();
  const options = events.slice(0, 25).map((eventName) => ({
    label: eventName.length > 100 ? eventName.slice(0, 97) + '...' : eventName,
    value: eventName,
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId('scheduler:event_select')
    .setPlaceholder('Select an event')
    .addOptions(options);

  return new ActionRowBuilder().addComponents(select);
}

function buildFrequencySelect() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('scheduler:frequency_select')
    .setPlaceholder('Choose frequency')
    .addOptions(
      { label: 'One Off', value: 'one_off', description: 'Single occurrence' },
      { label: 'Repeat every X hours', value: 'repeat_hours', description: 'Repeats forever by hour interval' },
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
        label: `${r.eventName}`.slice(0, 100),
        value: r.id,
        description: `${formatUtc(new Date(r.nextEventTime))}`.slice(0, 100),
      }))
    );

  return new ActionRowBuilder().addComponents(select);
}

function getReminderSummary(reminder) {
  const frequencyText = reminder.frequencyType === 'one_off'
    ? 'One Off'
    : `Every ${reminder.repeatHours} hours`;

  return [
    `**Event:** ${reminder.eventName}`,
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
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
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
    const content = `${mention}**${reminder.eventName}** starts ${leadText}.\nEvent time: ${formatUtc(eventDate)}\nLocal time: ${makeDiscordTimestamp(eventDate)}`;

    await channel.send({ content, allowedMentions: { parse: [], roles: reminder.pingRoleId ? [reminder.pingRoleId] : [] } });
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
      if (reminder.frequencyType === 'repeat_hours' && Number.isFinite(reminder.repeatHours) && reminder.repeatHours > 0) {
        let nextTime = eventTime;
        while (nextTime.getTime() <= now.getTime()) {
          nextTime = new Date(nextTime.getTime() + reminder.repeatHours * 60 * 60 * 1000);
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
          await interaction.reply({ content: `You need the **${SCHEDULER_ROLE_NAME}** role to use this command.`, ephemeral: true });
          return;
        }

        await interaction.reply({ ...buildMainPanel() });
      }
      return;
    }

    if (interaction.isButton()) {
      if (!hasSchedulerRole(interaction.member)) {
        await interaction.reply({ content: `You need the **${SCHEDULER_ROLE_NAME}** role to use this.`, ephemeral: true });
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
          ephemeral: true,
        });
        return;
      }

      if (interaction.customId === 'scheduler:list') {
        const reminders = loadReminders().filter((r) => r.active);
        if (!reminders.length) {
          await interaction.reply({ content: 'There are no active reminders.', ephemeral: true });
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle('Active Reminders')
          .setDescription(reminders.map((r, i) => `### ${i + 1}\n${getReminderSummary(r)}`).join('\n\n').slice(0, 4000));

        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }

      if (interaction.customId === 'scheduler:delete') {
        const reminders = loadReminders().filter((r) => r.active);
        if (!reminders.length) {
          await interaction.reply({ content: 'There are no active reminders to delete.', ephemeral: true });
          return;
        }

        await interaction.reply({
          content: 'Select a reminder to delete.',
          components: [buildDeleteSelect(reminders)],
          ephemeral: true,
        });
        return;
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (!hasSchedulerRole(interaction.member)) {
        await interaction.reply({ content: `You need the **${SCHEDULER_ROLE_NAME}** role to use this.`, ephemeral: true });
        return;
      }

      if (interaction.customId === 'scheduler:event_select') {
        const selected = interaction.values[0];
        const session = setupSessions.get(interaction.user.id) || {};
        session.eventName = selected;
        session.step = 'time';
        setupSessions.set(interaction.user.id, session);

        const modal = new ModalBuilder()
          .setCustomId('scheduler:time_modal')
          .setTitle('Enter Event Time (UTC)');

        const timeInput = new TextInputBuilder()
          .setCustomId('event_time_utc')
          .setLabel('UTC time: YYYY-MM-DD HH:mm')
          .setPlaceholder('2026-04-10 19:00')
          .setRequired(true)
          .setStyle(TextInputStyle.Short);

        const customEventInput = new TextInputBuilder()
          .setCustomId('custom_event_name')
          .setLabel('Custom event name (only if Custom Event selected)')
          .setRequired(false)
          .setStyle(TextInputStyle.Short);

        modal.addComponents(
          new ActionRowBuilder().addComponents(timeInput),
          new ActionRowBuilder().addComponents(customEventInput),
        );

        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === 'scheduler:frequency_select') {
        const session = setupSessions.get(interaction.user.id);
        if (!session) {
          await interaction.reply({ content: 'Your setup session expired. Please start again.', ephemeral: true });
          return;
        }

        const selected = interaction.values[0];
        session.frequencyType = selected;
        setupSessions.set(interaction.user.id, session);

        if (selected === 'one_off') {
          const reminder = {
            id: makeId(),
            eventName: session.eventName,
            nextEventTime: session.eventTime.toISOString(),
            frequencyType: 'one_off',
            repeatHours: null,
            alertChannelId: ALERT_CHANNEL_ID,
            pingRoleId: PING_ROLE_ID || null,
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

          await interaction.update({ content: 'Reminder created successfully.', embeds: [embed], components: [] });
          return;
        }

        const modal = new ModalBuilder()
          .setCustomId('scheduler:repeat_modal')
          .setTitle('Repeat Every X Hours');

        const hoursInput = new TextInputBuilder()
          .setCustomId('repeat_hours')
          .setLabel('Number of hours between events')
          .setPlaceholder('48')
          .setRequired(true)
          .setStyle(TextInputStyle.Short);

        modal.addComponents(new ActionRowBuilder().addComponents(hoursInput));
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === 'scheduler:delete_select') {
        const reminderId = interaction.values[0];
        const reminders = loadReminders();
        const reminder = reminders.find((r) => r.id === reminderId);

        if (!reminder) {
          await interaction.update({ content: 'Reminder not found.', components: [] });
          return;
        }

        reminder.active = false;
        saveReminders(reminders);

        await interaction.update({ content: `Deleted reminder for **${reminder.eventName}** at ${formatUtc(new Date(reminder.nextEventTime))}.`, components: [] });
        return;
      }
    }

    if (interaction.type === InteractionType.ModalSubmit) {
      if (!hasSchedulerRole(interaction.member)) {
        await interaction.reply({ content: `You need the **${SCHEDULER_ROLE_NAME}** role to use this.`, ephemeral: true });
        return;
      }

      if (interaction.customId === 'scheduler:time_modal') {
        const session = setupSessions.get(interaction.user.id) || {};
        let eventName = session.eventName;
        const eventTimeRaw = interaction.fields.getTextInputValue('event_time_utc');
        const customEventName = interaction.fields.getTextInputValue('custom_event_name').trim();

        if (eventName === 'Custom Event') {
          if (!customEventName) {
            await interaction.reply({ content: 'Please enter a custom event name.', ephemeral: true });
            return;
          }
          eventName = customEventName;
        }

        const parsedDate = parseUtcInput(eventTimeRaw);
        if (!parsedDate) {
          await interaction.reply({ content: 'Invalid UTC time. Use `YYYY-MM-DD HH:mm`.', ephemeral: true });
          return;
        }

        if (parsedDate.getTime() <= Date.now()) {
          await interaction.reply({ content: 'The event time must be in the future.', ephemeral: true });
          return;
        }

        session.eventName = eventName;
        session.eventTime = parsedDate;
        session.step = 'frequency';
        setupSessions.set(interaction.user.id, session);

        await interaction.reply({
          content: `Event selected: **${eventName}**\nTime: **${formatUtc(parsedDate)}**\nNow choose the frequency.`,
          components: [buildFrequencySelect()],
          ephemeral: true,
        });
        return;
      }

      if (interaction.customId === 'scheduler:repeat_modal') {
        const session = setupSessions.get(interaction.user.id);
        if (!session) {
          await interaction.reply({ content: 'Your setup session expired. Please start again.', ephemeral: true });
          return;
        }

        const hoursRaw = interaction.fields.getTextInputValue('repeat_hours').trim();
        const repeatHours = Number(hoursRaw);

        if (!Number.isFinite(repeatHours) || repeatHours <= 0) {
          await interaction.reply({ content: 'Please enter a valid number of hours greater than 0.', ephemeral: true });
          return;
        }

        const reminder = {
          id: makeId(),
          eventName: session.eventName,
          nextEventTime: session.eventTime.toISOString(),
          frequencyType: 'repeat_hours',
          repeatHours,
          alertChannelId: ALERT_CHANNEL_ID,
          pingRoleId: PING_ROLE_ID || null,
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

        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }
    }
  } catch (error) {
    console.error('Interaction handler error', error);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: 'Something went wrong while processing that action.', ephemeral: true }).catch(() => null);
    } else {
      await interaction.reply({ content: 'Something went wrong while processing that action.', ephemeral: true }).catch(() => null);
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
