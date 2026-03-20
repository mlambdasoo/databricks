import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getDatabricksToken, getAuthMethod } from '@chat-template/auth';

async function wipeMessages() {
  console.log('Getting database connection...');

  const authMethod = getAuthMethod();
  let password: string;

  if (authMethod === 'cli' || authMethod === 'oauth') {
    password = await getDatabricksToken();
  } else {
    throw new Error('No auth method available');
  }

  const client = postgres({
    host: process.env.PGHOST,
    database: process.env.PGDATABASE || 'databricks_postgres',
    user: process.env.PGUSER,
    password,
    port: Number(process.env.PGPORT) || 5432,
    ssl: 'require',
  });

  const db = drizzle(client);

  console.log('Deleting all messages...');
  await db.execute(sql`DELETE FROM ai_chatbot.message_v2`);
  console.log('Deleting all chats...');
  await db.execute(sql`DELETE FROM ai_chatbot.chat`);
  console.log('Done! Database wiped.');

  await client.end();
  process.exit(0);
}

wipeMessages().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
