import { cron } from "inngest";

import { processDueDemandAlerts } from "@/lib/demands/alerts";
import { inngest } from "@/lib/jobs/inngest-client";

export const checkDemandSla = inngest.createFunction(
  {
    id: "demand-sla-alerts",
    retries: 2,
    triggers: [cron("* * * * *")],
  },
  async ({ step }) => step.run("scan running demand timers", () => processDueDemandAlerts()),
);
