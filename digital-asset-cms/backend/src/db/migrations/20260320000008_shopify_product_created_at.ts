import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('products', (table) => {
    table.timestamp('shopify_created_at', { useTz: true }).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('products', (table) => {
    table.dropColumn('shopify_created_at');
  });
}
