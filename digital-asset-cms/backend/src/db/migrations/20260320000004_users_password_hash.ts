import type { Knex } from 'knex';

// §4.5 omits password_hash from the users table, but email+password auth requires it.
// This migration adds the nullable column — users who only use Google OAuth have no hash.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.text('password_hash').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('password_hash');
  });
}
