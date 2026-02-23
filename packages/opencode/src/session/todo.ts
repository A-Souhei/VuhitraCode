import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Database, eq, asc } from "../storage/db"
import { TodoTable } from "./session.sql"

export namespace Todo {
  export const Info = z
    .object({
      content: z.string().describe("Brief description of the task"),
      status: z.string().describe("Current status of the task: pending, in_progress, completed, cancelled"),
      priority: z.string().describe("Priority level of the task: high, medium, low"),
      assignedTo: z.string().optional().describe("Session ID of the Sentinel currently executing this item"),
      scoutId: z.string().optional().describe("Session ID of the Scout spawned by the assigned Sentinel"),
    })
    .meta({ ref: "Todo" })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define(
      "todo.updated",
      z.object({
        sessionID: z.string(),
        todos: z.array(Info),
      }),
    ),
  }

  export function update(input: { sessionID: string; todos: Info[] }) {
    Database.transaction((db) => {
      db.delete(TodoTable).where(eq(TodoTable.session_id, input.sessionID)).run()
      if (input.todos.length === 0) return
      db.insert(TodoTable)
        .values(
          input.todos.map((todo, position) => ({
            session_id: input.sessionID,
            content: todo.content,
            status: todo.status,
            priority: todo.priority,
            assigned_to: todo.assignedTo,
            scout_id: todo.scoutId,
            position,
          })),
        )
        .run()
    })
    Bus.publish(Event.Updated, input)
  }

  export function get(sessionID: string) {
    const rows = Database.use((db) =>
      db.select().from(TodoTable).where(eq(TodoTable.session_id, sessionID)).orderBy(asc(TodoTable.position)).all(),
    )
    return rows.map((row) => ({
      content: row.content,
      status: row.status,
      priority: row.priority,
      assignedTo: row.assigned_to ?? undefined,
      scoutId: row.scout_id ?? undefined,
    }))
  }
}
