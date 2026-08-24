import {
  DemandAlertRecipient,
  DemandAlertThreshold,
} from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  buildDemandAlertMessage,
  reachedDemandThresholds,
  recipientsForDemandThreshold,
} from "@/lib/demands/alerts";

describe("demand SLA alerts", () => {
  it("does not alert before 150% of the target", () => {
    expect(reachedDemandThresholds(44 * 60 + 59, 30)).toEqual([]);
  });

  it("alerts the assignee at exactly 150%", () => {
    expect(reachedDemandThresholds(45 * 60, 30)).toEqual([
      DemandAlertThreshold.OVER_BY_50,
    ]);
    expect(recipientsForDemandThreshold(DemandAlertThreshold.OVER_BY_50)).toEqual([
      DemandAlertRecipient.ASSIGNEE,
    ]);
  });

  it("alerts assignee, leader and group at exactly 200%", () => {
    expect(reachedDemandThresholds(60 * 60, 30)).toEqual([
      DemandAlertThreshold.OVER_BY_50,
      DemandAlertThreshold.OVER_BY_100,
    ]);
    expect(recipientsForDemandThreshold(DemandAlertThreshold.OVER_BY_100)).toEqual([
      DemandAlertRecipient.ASSIGNEE,
      DemandAlertRecipient.LEADER,
      DemandAlertRecipient.GROUP,
    ]);
  });

  it("builds a concise message with the current timer", () => {
    const message = buildDemandAlertMessage({
      threshold: DemandAlertThreshold.OVER_BY_100,
      title: "Melhorar os anúncios",
      categoryName: "Ads",
      assigneeName: "Ana",
      targetMinutes: 30,
      elapsedSeconds: 60 * 60,
    });
    expect(message).toContain("100% acima da meta");
    expect(message).toContain("Meta: 30 min · Tempo atual: 60 min");
  });
});
