import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  messages: defineTable({
    room: v.string(),
	authorId: v.string(),
    author: v.string(),
    body: v.string(),
  }).index("by_room", ["room"]),
  
  typing: defineTable({
  room: v.string(),
  userId: v.string(),
  name: v.string(),
  lastTyped: v.number(),
})
  .index("by_room", ["room"])
  .index("by_room_user", ["room", "userId"]),

  presence: defineTable({
  room: v.string(),
  userId: v.string(),
  name: v.string(),
  lastSeen: v.number(),
})
  .index("by_room", ["room"])
  .index("by_room_user", ["room", "userId"])
  .index("by_user", ["userId"]),

});


