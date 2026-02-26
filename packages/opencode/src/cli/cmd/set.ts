import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Instance } from "../../project/instance"
import { VuHitraSettings } from "../../project/vuhitra-settings"

const SetReviewMaxRoundCommand = cmd({
  command: "review_max_round <n>",
  describe: "set the maximum number of keeper review rounds",
  builder: (yargs: Argv) =>
    yargs
      .positional("n", {
        describe: "positive integer",
        type: "number",
        demandOption: true,
      })
      .check((args) => {
        if (!Number.isInteger(args.n) || args.n < 1) throw new Error("n must be a positive integer")
        return true
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.env.PWD ?? process.cwd(),
      async fn() {
        const prev = VuHitraSettings.reviewMaxRounds()
        await VuHitraSettings.setReviewMaxRounds(args.n)
        process.stdout.write(`✓ review_max_round set to ${args.n} (was: ${prev})` + "\n")
      },
    })
  },
})

export const SetCommand = cmd({
  command: "set",
  describe: "configure project settings",
  builder: (yargs) => yargs.command(SetReviewMaxRoundCommand).demandCommand(),
  handler() {},
})
