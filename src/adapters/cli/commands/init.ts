import { createInterface } from 'node:readline';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { Command } from 'commander';
import type { MindFlowConfig } from '../../../types/index.js';
import { PrivacyMode } from '../../../types/index.js';
import { MindFlowEngine } from '../../../core/engine.js';
import {
  channelBadge,
  divider,
  error,
  header,
  info,
  pc,
  success,
  warn,
} from '../ui.js';

// ----------------------------------------------------------------------------
// Readline helpers
// ----------------------------------------------------------------------------

function rl(): ReturnType<typeof createInterface> {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(
  iface: ReturnType<typeof createInterface>,
  question: string,
  defaultValue = '',
): Promise<string> {
  const prompt =
    defaultValue
      ? `${question} ${pc.dim(`[${defaultValue}]`)}: `
      : `${question}: `;
  return new Promise((resolve) => {
    iface.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

function askYesNo(
  iface: ReturnType<typeof createInterface>,
  question: string,
  defaultYes = true,
): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  return new Promise((resolve) => {
    iface.question(`${question} ${pc.dim(`[${hint}]`)}: `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (!a) return resolve(defaultYes);
      resolve(a === 'y' || a === 'yes');
    });
  });
}

async function askChoice<T extends string>(
  iface: ReturnType<typeof createInterface>,
  question: string,
  choices: Array<{ value: T; label: string }>,
  defaultValue: T,
): Promise<T> {
  console.log(question);
  choices.forEach((c, i) => {
    const marker = c.value === defaultValue ? pc.green('●') : pc.dim('○');
    console.log(`  ${marker} ${i + 1}) ${c.label}`);
  });
  const answer = await ask(
    iface,
    `Choose (1-${choices.length})`,
    String(choices.findIndex((c) => c.value === defaultValue) + 1),
  );
  const idx = parseInt(answer, 10) - 1;
  if (idx >= 0 && idx < choices.length) {
    return choices[idx]!.value;
  }
  return defaultValue;
}

// ----------------------------------------------------------------------------
// Section wizards
// ----------------------------------------------------------------------------

async function configureEmail(
  iface: ReturnType<typeof createInterface>,
): Promise<MindFlowConfig['sources']['gmail'] | undefined> {
  header('Email (Gmail via IMAP)');
  const enabled = await askYesNo(iface, 'Enable Gmail/IMAP integration?', false);
  if (!enabled) return undefined;

  const host = await ask(iface, 'IMAP host', 'imap.gmail.com');
  const portStr = await ask(iface, 'IMAP port', '993');
  const user = await ask(iface, 'Email address');
  const password = await ask(iface, 'App password (not stored in plaintext — use env var in prod)');
  const tls = await askYesNo(iface, 'Use TLS?', true);
  const foldersStr = await ask(iface, 'Folders to index (comma-separated)', 'INBOX');
  const folders = foldersStr.split(',').map((s) => s.trim()).filter(Boolean);

  return {
    enabled: true,
    auth: {
      type: 'imap',
      host,
      port: parseInt(portStr, 10) || 993,
      user,
      password,
      tls,
    },
    folders,
    excludeLabels: [],
  };
}

async function configureIMessage(
  iface: ReturnType<typeof createInterface>,
): Promise<MindFlowConfig['sources']['imessage'] | undefined> {
  header(`iMessage ${channelBadge('imessage')}`);

  if (platform() !== 'darwin') {
    warn('iMessage integration requires macOS — skipping.');
    return undefined;
  }

  const defaultDb = join(homedir(), 'Library/Messages/chat.db');
  const hasAccess = existsSync(defaultDb);

  if (!hasAccess) {
    warn('chat.db not found at ' + defaultDb);
    warn('MindFlow needs Full Disk Access. Grant it in:');
    info('System Settings → Privacy & Security → Full Disk Access');
    const skip = await askYesNo(iface, 'Configure anyway?', false);
    if (!skip) return undefined;
  }

  const enabled = await askYesNo(iface, 'Enable iMessage integration?', true);
  if (!enabled) return undefined;

  const dbPath = await ask(iface, 'Path to chat.db', defaultDb);
  return { enabled: true, dbPath, excludeHandles: [] };
}

async function configureFilesystem(
  iface: ReturnType<typeof createInterface>,
): Promise<MindFlowConfig['sources']['filesystem'] | undefined> {
  header('Document watching (filesystem)');
  const enabled = await askYesNo(iface, 'Enable filesystem/document watching?', false);
  if (!enabled) return undefined;

  const pathsStr = await ask(
    iface,
    'Directories to watch (comma-separated)',
    join(homedir(), 'Documents'),
  );
  const watchPaths = pathsStr.split(',').map((s) => s.trim()).filter(Boolean);

  return {
    enabled: true,
    watchPaths,
    extensions: ['.md', '.txt', '.pdf', '.docx'],
    ignorePatterns: ['node_modules', '.git'],
  };
}

async function configureExclusions(
  iface: ReturnType<typeof createInterface>,
): Promise<MindFlowConfig['exclusions']> {
  header('Exclusions');
  const contactsStr = await ask(
    iface,
    'Contacts/emails to exclude (comma-separated, or blank)',
    '',
  );
  const contacts = contactsStr ? contactsStr.split(',').map((s) => s.trim()) : [];
  const patternsStr = await ask(
    iface,
    'Keyword patterns to exclude (comma-separated, or blank)',
    '',
  );
  const patterns = patternsStr ? patternsStr.split(',').map((s) => s.trim()) : [];
  return { contacts, emailLabels: [], patterns };
}

async function configureLLM(
  iface: ReturnType<typeof createInterface>,
): Promise<MindFlowConfig['llm']> {
  header('LLM Provider');

  const choice = await askChoice(
    iface,
    'Choose LLM provider for extraction:',
    [
      { value: 'claude', label: 'Claude (Anthropic) — cloud, best quality' },
      { value: 'openai', label: 'OpenAI — cloud' },
      { value: 'ollama', label: 'Ollama — local, no API cost' },
      { value: 'openclaw', label: 'OpenClaw Gateway — read token from ~/.openclaw credentials' },
      { value: 'azure', label: 'Azure OpenAI — cloud, enterprise' },
      { value: 'skip', label: 'Skip for now' },
    ],
    'claude',
  );

  const providers: Record<string, Record<string, unknown>> = {};

  if (choice === 'claude') {
    const apiKey = await ask(iface, 'Anthropic API key (or set ANTHROPIC_API_KEY env var)');
    if (apiKey) providers['claude'] = { apiKey };
    else info('Set ANTHROPIC_API_KEY environment variable before running MindFlow.');
  } else if (choice === 'openai') {
    const apiKey = await ask(iface, 'OpenAI API key (or set OPENAI_API_KEY env var)');
    if (apiKey) providers['openai'] = { apiKey };
  } else if (choice === 'ollama') {
    const baseUrl = await ask(iface, 'Ollama base URL', 'http://localhost:11434');
    const model = await ask(iface, 'Model name', 'llama3');
    providers['ollama'] = { baseUrl, model };
  } else if (choice === 'openclaw') {
    const gatewayUrl = await ask(iface, 'Gateway URL', 'http://127.0.0.1:18789');
    const token = await ask(
      iface,
      'Auth token (or set OPENCLAW_GATEWAY_TOKEN env var)',
    );
    const model = await ask(iface, 'Model override (leave blank for "default")', '');
    providers['openclaw'] = {
      gatewayUrl,
      ...(token ? { token } : {}),
      ...(model ? { model } : {}),
    };
  } else if (choice === 'azure') {
    const endpoint = await ask(
      iface,
      'Azure OpenAI endpoint (e.g. https://{resource}.openai.azure.com)',
    );
    const deploymentName = await ask(iface, 'Chat deployment name');
    const apiKey = await ask(iface, 'API key');
    const apiVersion = await ask(iface, 'API version', '2024-12-01-preview');
    const embeddingDeployment = await ask(
      iface,
      'Embedding deployment name (leave blank to skip embeddings)',
      '',
    );
    providers['azure'] = {
      endpoint,
      deploymentName,
      apiKey,
      apiVersion,
      ...(embeddingDeployment ? { embeddingDeployment } : {}),
    };
  }

  const budgetStr = await ask(
    iface,
    'Monthly cloud LLM budget cap in USD (0 = unlimited)',
    '0',
  );

  const extractionProvider = choice === 'skip' ? 'claude' : choice;
  return {
    extractionProvider,
    answerProvider: extractionProvider,
    monthlyBudgetCap: parseFloat(budgetStr) || 0,
    providers,
  };
}

// ----------------------------------------------------------------------------
// Main init command
// ----------------------------------------------------------------------------

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Interactive setup wizard — configure sources, LLM, and preferences')
    .action(async () => {
      header('MindFlow Setup Wizard');
      console.log(
        pc.dim('This wizard configures MindFlow. Press Enter to accept defaults.\n'),
      );

      const iface = rl();

      try {
        // Data directory
        const dataDir = await ask(
          iface,
          'Data directory',
          join(homedir(), '.mindflow'),
        );
        const dbPath = join(dataDir, 'data', 'mindflow.db');

        // Sources
        const gmail = await configureEmail(iface);
        const imessage = await configureIMessage(iface);
        const filesystem = await configureFilesystem(iface);

        // Exclusions
        const exclusions = await configureExclusions(iface);

        // LLM
        const llm = await configureLLM(iface);

        // Privacy mode
        header('Privacy Mode');
        const privacyMode = await askChoice<PrivacyMode>(
          iface,
          'Choose privacy mode:',
          [
            {
              value: PrivacyMode.ContentAware,
              label: 'Content-aware — route sensitive items to local LLM',
            },
            {
              value: PrivacyMode.FullLocal,
              label: 'Full local — never send content to cloud',
            },
            {
              value: PrivacyMode.MinimalCloud,
              label: 'Minimal cloud — use cloud only when necessary',
            },
          ],
          PrivacyMode.ContentAware,
        );

        // Initial scan depth
        header('Initial Scan');
        const initialScanDepth = await askChoice<MindFlowConfig['initialScanDepth']>(
          iface,
          'How far back should MindFlow scan on first run?',
          [
            { value: 'month', label: 'Last 30 days (fast)' },
            { value: '6months', label: 'Last 6 months' },
            { value: 'year', label: 'Last year' },
            { value: 'all', label: 'Everything (slow)' },
          ],
          'month',
        );

        iface.close();

        // Build and save config
        const updates: Partial<MindFlowConfig> = {
          dataDir,
          dbPath,
          llm,
          exclusions,
          privacyMode,
          initialScanDepth,
          sources: {
            ...(gmail ? { gmail } : {}),
            ...(imessage ? { imessage } : {}),
            ...(filesystem ? { filesystem } : {}),
          },
        };

        divider();
        const spinner = { stop: (msg?: string) => msg && success(msg) };
        process.stdout.write(pc.dim('Saving configuration...\n'));

        const engine = new MindFlowEngine(updates);
        await engine.init();
        engine.updateConfig(updates);
        engine.close();

        spinner.stop('Configuration saved to ' + dbPath);
        console.log('');
        console.log(pc.bold('Next steps:'));
        info('Run ' + pc.cyan('mindflow ingest') + ' to start indexing');
        info('Run ' + pc.cyan('mindflow status') + ' to check progress');
        info('Run ' + pc.cyan('mindflow query "..."') + ' to search your knowledge base');
        console.log('');
      } catch (err) {
        iface.close();
        error(String(err instanceof Error ? err.message : err));
        process.exit(1);
      }
    });
}
