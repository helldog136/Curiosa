/* eslint-disable @typescript-eslint/no-require-imports */
const bcrypt = require("/dev/shm/s7/node_modules/bcryptjs");
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.env.DATA_DIR + "/curiosa.db");
const h = bcrypt.hashSync("e2e-password-123", 10);
db.prepare("update User set passwordHash=?, mustChangePassword=0, totpSecret=null, locale='" + (process.env.LOC||"fr") + "', advanced=0").run(h);
console.log(JSON.stringify(db.prepare("select email,role,locale from User").all()));
