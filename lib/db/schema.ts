import { relations } from 'drizzle-orm'
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { newId, now } from './helpers'

export const clientes = sqliteTable('clientes', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => newId()),
  nome: text('nome').notNull(),
  nicho: text('nicho'),
  estiloDescricao: text('estilo_descricao'),
  exemplosTitulos: text('exemplos_titulos'),
  exemplosDescricoes: text('exemplos_descricoes'),
  dadosFiscais: text('dados_fiscais'),
  ativo: integer('ativo').notNull().default(1),
  createdAt: integer('created_at').notNull().$defaultFn(() => now()),
  updatedAt: integer('updated_at').notNull().$defaultFn(() => now()),
})

export const tokensMl = sqliteTable('tokens_ml', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => newId()),
  clienteId: text('cliente_id')
    .notNull()
    .references(() => clientes.id),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt: integer('expires_at'),
  mlUserId: text('ml_user_id'),
  createdAt: integer('created_at').notNull().$defaultFn(() => now()),
  updatedAt: integer('updated_at').notNull().$defaultFn(() => now()),
})

export const tokensShopee = sqliteTable('tokens_shopee', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => newId()),
  clienteId: text('cliente_id')
    .notNull()
    .references(() => clientes.id),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt: integer('expires_at'),
  shopId: integer('shop_id'),
  createdAt: integer('created_at').notNull().$defaultFn(() => now()),
  updatedAt: integer('updated_at').notNull().$defaultFn(() => now()),
})

export const produtos = sqliteTable('produtos', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => newId()),
  clienteId: text('cliente_id')
    .notNull()
    .references(() => clientes.id),
  nomeOriginal: text('nome_original').notNull(),
  fotoUrl: text('foto_url'),
  status: text('status').notNull().default('rascunho'),
  tituloMl: text('titulo_ml'),
  tituloShopee: text('titulo_shopee'),
  descricao: text('descricao'),
  categoriaMlId: text('categoria_ml_id'),
  categoriaShopeeId: integer('categoria_shopee_id'),
  preco: real('preco').notNull(),
  quantidade: integer('quantidade').notNull().default(1),
  condicao: text('condicao').default('not_specified'),
  atributos: text('atributos'),
  payloadMl: text('payload_ml'),
  payloadShopee: text('payload_shopee'),
  mlItemId: text('ml_item_id'),
  shopeeItemId: integer('shopee_item_id'),
  createdAt: integer('created_at').notNull().$defaultFn(() => now()),
  updatedAt: integer('updated_at').notNull().$defaultFn(() => now()),
})

export const publicacoes = sqliteTable('publicacoes', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => newId()),
  produtoId: text('produto_id')
    .notNull()
    .references(() => produtos.id),
  clienteId: text('cliente_id')
    .notNull()
    .references(() => clientes.id),
  plataforma: text('plataforma').notNull(),
  status: text('status').notNull().default('pendente'),
  respostaApi: text('resposta_api'),
  erroMensagem: text('erro_mensagem'),
  tentativa: integer('tentativa').notNull().default(1),
  createdAt: integer('created_at').notNull().$defaultFn(() => now()),
})

export const clientesRelacionamentos = relations(clientes, ({ many }) => ({
  produtos: many(produtos),
  tokensMl: many(tokensMl),
  tokensShopee: many(tokensShopee),
  publicacoes: many(publicacoes),
}))

export const tokensMlRelacionamentos = relations(tokensMl, ({ one }) => ({
  cliente: one(clientes, {
    fields: [tokensMl.clienteId],
    references: [clientes.id],
  }),
}))

export const tokensShopeeRelacionamentos = relations(tokensShopee, ({ one }) => ({
  cliente: one(clientes, {
    fields: [tokensShopee.clienteId],
    references: [clientes.id],
  }),
}))

export const produtosRelacionamentos = relations(produtos, ({ one, many }) => ({
  cliente: one(clientes, {
    fields: [produtos.clienteId],
    references: [clientes.id],
  }),
  publicacoes: many(publicacoes),
}))

export const publicacoesRelacionamentos = relations(publicacoes, ({ one }) => ({
  produto: one(produtos, {
    fields: [publicacoes.produtoId],
    references: [produtos.id],
  }),
  cliente: one(clientes, {
    fields: [publicacoes.clienteId],
    references: [clientes.id],
  }),
}))
