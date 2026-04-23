import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('product_variants', (table) => {
    table.integer('inventory_quantity').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('product_variants', (table) => {
    table.dropColumn('inventory_quantity');
  });
}
