import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('assets', (table) => {
    table.text('alt_text').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('assets', (table) => {
    table.dropColumn('alt_text');
  });
}
