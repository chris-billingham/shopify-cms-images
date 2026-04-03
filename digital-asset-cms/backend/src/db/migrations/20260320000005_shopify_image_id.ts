import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('assets', (table) => {
    table.text('shopify_image_id').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('assets', (table) => {
    table.dropColumn('shopify_image_id');
  });
}
