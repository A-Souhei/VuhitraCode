import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "@/session/session.sql"
import { Timestamps } from "@/storage/schema.sql"

export const BridgeNodeTable = sqliteTable(
  "bridge_node",
  {
    session_id: text()
      .primaryKey()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    bridge_id: text().notNull(),
    role: text().notNull(),
    directory: text().notNull(),
    node_url: text().notNull(),
    status: text().notNull().default("active"),
    limit: integer().notNull().default(3),
    coordinator: text(),
    ...Timestamps,
  },
  (table) => [index("bridge_node_bridge_idx").on(table.bridge_id)],
)
