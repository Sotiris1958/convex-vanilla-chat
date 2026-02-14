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
  
  reactions: defineTable({
  messageId: v.id("messages"),
  room: v.string(),
  userId: v.string(),     // identity.subject
  emoji: v.string(),      // "👍", "❤️", ...
})
  .index("by_message", ["messageId"])
  .index("by_room_message", ["room", "messageId"])
  .index("by_message_user_emoji", ["messageId", "userId", "emoji"]),


  presence: defineTable({
    room: v.string(),
    userId: v.string(),
    name: v.string(),
    sessionId: v.string(),
    lastSeen: v.number(),
  })
  .index("by_room", ["room"])
  .index("by_user", ["userId"])
  .index("by_room_user_session", ["room", "userId", "sessionId"]),

});


