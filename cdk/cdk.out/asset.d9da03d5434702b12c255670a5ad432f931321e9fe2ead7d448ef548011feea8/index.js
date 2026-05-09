"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// revenuecat-webhook/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var dynamo = new import_client_dynamodb.DynamoDBClient({});
var USERS_TABLE = process.env.USERS_TABLE;
var WEBHOOK_SECRET = process.env.REVENUECAT_WEBHOOK_SECRET;
var ACTIVE_EVENTS = /* @__PURE__ */ new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION"
]);
var INACTIVE_EVENTS = /* @__PURE__ */ new Set([
  "EXPIRATION",
  "BILLING_ISSUES_DETECTED"
]);
var handler = async (event) => {
  const authHeader = event.headers?.authorization ?? event.headers?.Authorization ?? "";
  if (!WEBHOOK_SECRET || authHeader !== WEBHOOK_SECRET) {
    console.warn("[revenuecat-webhook] unauthorized request");
    return { statusCode: 401, body: "Unauthorized" };
  }
  let body;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return { statusCode: 400, body: "Bad Request" };
  }
  const type = body.event?.type;
  const userId = body.event?.app_user_id;
  if (!type || !userId) {
    console.warn("[revenuecat-webhook] missing type or app_user_id", { type, userId });
    return { statusCode: 400, body: "Bad Request" };
  }
  let subscribed = null;
  if (ACTIVE_EVENTS.has(type)) subscribed = true;
  else if (INACTIVE_EVENTS.has(type)) subscribed = false;
  if (subscribed === null) {
    console.log("[revenuecat-webhook] ignored event", { type, userId });
    return { statusCode: 200, body: "Ignored" };
  }
  console.log("[revenuecat-webhook] updating subscription", { type, userId, subscribed });
  await dynamo.send(
    new import_client_dynamodb.UpdateItemCommand({
      TableName: USERS_TABLE,
      Key: { userId: { S: userId } },
      UpdateExpression: "SET subscribed = :s",
      ExpressionAttributeValues: { ":s": { BOOL: subscribed } }
    })
  );
  return { statusCode: 200, body: "OK" };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
