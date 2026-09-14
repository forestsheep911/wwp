import assert from "node:assert/strict";
import test from "node:test";
import { emptyPersonCatalogState, rebuildDerivedPersonIndexes } from "@wwpdw/cache-store";
import type { MovieCreditEntry, PersonProfile, SearchResult } from "@wwpdw/shared";
import { applyPersonCatalogPlan, planReviewedPeopleReportApply, type ReviewedPeopleReport } from "./person-catalog-apply.js";

const personId = "person_123e4567-e89b-42d3-a456-426614174000";
const profile: PersonProfile = {
  personId,
  names: [{ value: "张三", kind: "display", source: "tmdb", status: "verified", observedAt: "2026-08-10T00:00:00.000Z" }],
  externalIds: { tmdb: "10" },
  dataQuality: { status: "partial", updatedAt: "2026-08-10T00:00:00.000Z" },
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z"
};

function result(workId: string, title = workId): SearchResult {
  return {
    assetKey: `asset-${workId}`, title, source: "notion", sourceUrl: "https://example.test", durationLabel: "1h",
    updatedAt: "2026-08-01T00:00:00.000Z", summary: "",
    metadata: { work: { workId, kind: "movie", titles: [{ title, kind: "primary", source: "manual" }], updatedAt: "2026-08-01T00:00:00.000Z" } }
  };
}

function report(): ReviewedPeopleReport {
  return {
    generatedAt: "2026-08-10T00:00:00.000Z", proposedProfiles: [profile], identityIssues: [], unresolved: [],
    proposedCredits: [{ workId: "work-1", title: "作品一", credits: [{ personId, name: "张三", department: "directing", job: "Director", source: "tmdb" }] }]
  };
}

test("plans one affected work while retaining unrelated catalog data", () => {
  const current = emptyPersonCatalogState("2026-08-01T00:00:00.000Z");
  current.creditsByWorkId["work-2"] = [];
  const untouched = result("work-2");
  const plan = planReviewedPeopleReportApply(current, [result("work-1"), untouched], report(), "2026-08-10T01:00:00.000Z");
  assert.equal(plan.updatedResults.length, 1);
  assert.equal(plan.updatedResults[0].metadata?.work?.credits?.[0].personId, personId);
  assert.equal(plan.nextCatalog.creditsByPersonId[personId][0].workTitle, "work-1");
  assert.ok(plan.nextCatalog.creditsByWorkId["work-2"]);
  assert.equal(untouched.metadata?.work?.credits, undefined);
});

test("keeps unlinked cast relations in the work while indexing only materialized people", () => {
  const pilot = report();
  pilot.proposedCredits[0].credits.push({
    name: "待补演员",
    department: "acting",
    job: "Actor",
    character: "配角",
    source: "wikidata",
    externalIds: { wikidata: "Q99" }
  });
  const plan = planReviewedPeopleReportApply(emptyPersonCatalogState(), [result("work-1")], pilot);
  assert.equal(plan.summary.linkedCreditCount, 1);
  assert.equal(plan.summary.unlinkedCreditCount, 1);
  assert.equal(plan.updatedResults[0].metadata?.work?.credits?.length, 2);
  assert.equal(plan.updatedResults[0].metadata?.work?.credits?.[1].personId, undefined);
  assert.equal(plan.nextCatalog.creditsByWorkId["work-1"].length, 1);
});

test("merges reviewed links into the complete canonical source credit list", () => {
  const movie = result("work-1");
  const sourceCredits: NonNullable<NonNullable<SearchResult["metadata"]>["work"]>["credits"] = [
    { name: "张三", department: "directing", job: "Director", source: "tmdb" },
    { name: "待补演员", department: "acting", job: "Actor", source: "tmdb" },
  ];
  movie.metadata = {
    ...movie.metadata,
    credits: structuredClone(sourceCredits),
    work: { ...movie.metadata!.work!, credits: structuredClone(sourceCredits) }
  };
  const plan = planReviewedPeopleReportApply(emptyPersonCatalogState(), [movie], report());
  assert.equal(plan.summary.linkedCreditCount, 1);
  assert.equal(plan.summary.unlinkedCreditCount, 1);
  assert.equal(plan.updatedResults[0].metadata?.work?.credits?.length, 2);
  assert.equal(plan.updatedResults[0].metadata?.work?.credits?.[0].personId, personId);
  assert.equal(plan.updatedResults[0].metadata?.work?.credits?.[1].personId, undefined);
  assert.equal(plan.nextCatalog.creditsByWorkId["work-1"].length, 1);
});

test("matches a reviewed person through a verified profile alias when the source row has no external id", () => {
  const movie = result("work-1");
  const sourceCredits: MovieCreditEntry[] = [
    { name: "劳拉·比尔恩", department: "acting", job: "Actor", source: "tmdb" }
  ];
  movie.metadata = {
    ...movie.metadata,
    credits: structuredClone(sourceCredits),
    work: { ...movie.metadata!.work!, credits: structuredClone(sourceCredits) }
  };
  const reviewedPerson = structuredClone(profile);
  reviewedPerson.personId = personId;
  reviewedPerson.names = [
    { value: "劳拉·布林", language: "zh-CN", kind: "display", source: "manual", status: "verified", observedAt: "2026-08-10T00:00:00.000Z" },
    { value: "劳拉·比尔恩", language: "zh", kind: "alternate", source: "wikidata", status: "strong", observedAt: "2026-08-10T00:00:00.000Z" }
  ];
  const reviewed = report();
  reviewed.proposedProfiles = [reviewedPerson];
  reviewed.proposedCredits[0].credits = [{
    name: "劳拉·布林",
    originalName: "Laura Birn",
    department: "acting",
    job: "Actor",
    source: "wikidata",
    externalIds: { wikidata: "Q10" },
    personId
  }];
  const plan = planReviewedPeopleReportApply(emptyPersonCatalogState(), [movie], reviewed);
  assert.equal(plan.summary.linkedCreditCount, 1);
  assert.equal(plan.summary.unlinkedCreditCount, 0);
  assert.equal(plan.updatedResults[0].metadata?.work?.credits?.length, 1);
  assert.equal(plan.updatedResults[0].metadata?.work?.credits?.[0].personId, personId);
});

test("uses existing catalog aliases to collapse an unlinked duplicate credit into the linked relation", () => {
  const existing = structuredClone(profile);
  existing.names = [
    { value: "弗兰卡·波坦特", language: "zh-CN", kind: "display", source: "manual", status: "verified", observedAt: existing.updatedAt },
    { value: "弗朗卡·波滕特", language: "zh-CN", kind: "alternate", source: "manual", status: "verified", observedAt: existing.updatedAt }
  ];
  existing.externalIds = { imdb: "nm0004376", wikidata: "Q65105" };
  const current = emptyPersonCatalogState();
  current.people[personId] = { profile: existing, workIds: ["work-1"], updatedAt: existing.updatedAt };
  rebuildDerivedPersonIndexes(current, { "work-1": "作品一" });

  const movie = result("work-1");
  const sourceCredits: MovieCreditEntry[] = [
    { personId, name: "弗兰卡·波坦特", department: "acting", job: "Actor", source: "wikidata", externalIds: existing.externalIds },
    { name: "弗朗卡·波滕特", department: "acting", job: "Actor", source: "douban" }
  ];
  movie.metadata = {
    ...movie.metadata,
    credits: structuredClone(sourceCredits),
    work: { ...movie.metadata!.work!, credits: structuredClone(sourceCredits) }
  };
  const reviewed = report();
  reviewed.proposedProfiles = [];
  reviewed.proposedCredits[0].credits = [{
    personId,
    name: "弗朗卡·波滕特",
    department: "acting",
    job: "Actor",
    source: "manual",
    externalIds: existing.externalIds
  }];

  const plan = planReviewedPeopleReportApply(current, [movie], reviewed);
  const credits = plan.updatedResults[0].metadata?.work?.credits ?? [];
  assert.equal(credits.length, 1);
  assert.deepEqual(credits.map((credit) => credit.personId), [personId]);
  assert.equal(credits[0].name, "弗兰卡·波坦特");
});

test("reuses an existing canonical person when a reviewed report rediscovers the same stable identity", () => {
  const existingPersonId = "person_323e4567-e89b-42d3-a456-426614174002";
  const existing = structuredClone(profile);
  existing.personId = existingPersonId;
  existing.externalIds = { tmdb: "1125581", imdb: "nm4006608", wikidata: "Q18030614" };
  const current = emptyPersonCatalogState();
  current.people[existingPersonId] = {
    profile: existing,
    workIds: [],
    updatedAt: existing.updatedAt
  };
  const reviewed = report();
  const rediscovered = structuredClone(reviewed.proposedProfiles[0] ?? profile);
  rediscovered.personId = "person_423e4567-e89b-42d3-a456-426614174003";
  rediscovered.externalIds = existing.externalIds;
  reviewed.proposedProfiles = [rediscovered];
  reviewed.proposedCredits[0].credits[0].personId = rediscovered.personId;
  const plan = planReviewedPeopleReportApply(current, [result("work-1")], reviewed);
  assert.equal(plan.summary.profileCount, 1);
  assert.equal(plan.nextCatalog.people[existingPersonId]?.profile.personId, existingPersonId);
  assert.equal(plan.nextCatalog.people[rediscovered.personId], undefined);
  assert.equal(plan.updatedResults[0].metadata?.work?.credits?.[0].personId, existingPersonId);
});

test("prefers checkpointed reviewed IDs and redirects a stale catalog identity", () => {
  const retiredPersonId = "person_323e4567-e89b-42d3-a456-426614174002";
  const retired = structuredClone(profile);
  retired.personId = retiredPersonId;
  const current = emptyPersonCatalogState();
  current.people[retiredPersonId] = { profile: retired, workIds: ["work-old"], updatedAt: retired.updatedAt };
  current.creditsByWorkId["work-old"] = [{ personId: retiredPersonId, name: "张三", department: "acting", source: "tmdb" }];
  rebuildDerivedPersonIndexes(current, { "work-old": "旧作品" });
  const plan = planReviewedPeopleReportApply(current, [result("work-1")], report(), "2026-08-10T01:00:00.000Z", { preferReviewedPersonIds: true });
  assert.equal(plan.nextCatalog.people[retiredPersonId], undefined);
  assert.ok(plan.nextCatalog.people[personId]);
  assert.equal(plan.nextCatalog.redirects[retiredPersonId], personId);
  assert.equal(plan.nextCatalog.creditsByWorkId["work-old"][0].personId, personId);
  assert.equal(plan.updatedResults[0].metadata?.work?.credits?.[0].personId, personId);
});

test("checkpointed reviewed IDs replace stale Notion page bindings after identity merge", () => {
  const retiredPersonId = "person_323e4567-e89b-42d3-a456-426614174002";
  const retired = structuredClone(profile);
  retired.personId = retiredPersonId;
  retired.sourceRefs = [{ source: "notion", id: "old-page", observedAt: retired.updatedAt }];
  const current = emptyPersonCatalogState();
  current.people[retiredPersonId] = { profile: retired, workIds: [], updatedAt: retired.updatedAt };
  rebuildDerivedPersonIndexes(current);
  const plan = planReviewedPeopleReportApply(current, [result("work-1")], report(), "2026-08-10T01:00:00.000Z", {
    preferReviewedPersonIds: true,
    reviewedNotionPageIds: { [personId]: "new-page" }
  });
  assert.deepEqual(
    plan.nextCatalog.people[personId].profile.sourceRefs?.filter((ref) => ref.source === "notion").map((ref) => ref.id),
    ["new-page"]
  );
  assert.equal(plan.summary.catalogChanged, true);
});

test("checkpointed reviewed IDs bind a newly created Notion person before first catalog publication", () => {
  const current = emptyPersonCatalogState();
  const plan = planReviewedPeopleReportApply(current, [result("work-1")], report(), "2026-08-10T01:00:00.000Z", {
    preferReviewedPersonIds: true,
    reviewedNotionPageIds: { [personId]: "new-page" }
  });
  assert.ok(plan.nextCatalog.people[personId]);
  assert.deepEqual(
    plan.nextCatalog.people[personId].profile.sourceRefs?.filter((ref) => ref.source === "notion").map((ref) => ref.id),
    ["new-page"]
  );
  assert.equal(plan.updatedResults[0].metadata?.work?.credits?.[0].personId, personId);
  assert.equal(plan.summary.catalogChanged, true);
});

test("replaces a cross-work-contaminated credit set only when every source guard matches", () => {
  const preservedPersonId = "person_323e4567-e89b-42d3-a456-426614174002";
  const preservedProfile = structuredClone(profile);
  preservedProfile.personId = preservedPersonId;
  preservedProfile.externalIds = { tmdb: "11" };
  const movie = result("work-1");
  const sourceCredits: MovieCreditEntry[] = [
    { personId, name: "正确导演", department: "directing", source: "wikidata", externalIds: { wikidata: "Q10" } },
    { personId: preservedPersonId, name: "正确编剧", department: "writing", source: "wikidata", externalIds: { wikidata: "Q11" } },
    { personId: "person_223e4567-e89b-42d3-a456-426614174001", name: "串片演员", department: "acting", source: "wikidata", externalIds: { wikidata: "Q99" } }
  ];
  movie.metadata = {
    ...movie.metadata,
    externalIds: { imdb: "tt0000001", tmdb: "100" },
    credits: structuredClone(sourceCredits),
    work: {
      ...movie.metadata!.work!,
      externalIds: { imdb: "tt0000001", tmdb: "100" },
      credits: structuredClone(sourceCredits)
    }
  };
  const reviewed = report();
  reviewed.proposedProfiles.push(preservedProfile);
  reviewed.proposedCredits[0] = {
    workId: "work-1",
    title: "作品一",
    credits: [{ personId, name: "正确导演", department: "directing", source: "wikidata", externalIds: { wikidata: "Q10" } }],
    creditReplacement: {
      mode: "replace-contaminated",
      reason: "cross-work-contamination",
      expectedAssetKey: "asset-work-1",
      expectedSourceCreditCount: 3,
      expectedLinkedPersonIds: [personId, preservedPersonId, "person_223e4567-e89b-42d3-a456-426614174001"],
      preserveExistingPersonIds: [preservedPersonId],
      expectedWorkExternalIds: { imdb: "tt0000001", tmdb: "100" },
      authoritativeSource: "wikidata",
      authoritativeSourceWorkId: "Q1"
    }
  };
  const plan = planReviewedPeopleReportApply(emptyPersonCatalogState(), [movie], reviewed);
  assert.equal(plan.updatedResults[0].metadata?.work?.credits?.length, 2);
  assert.equal(plan.updatedResults[0].metadata?.work?.credits?.[0].name, "正确导演");
  assert.equal(plan.updatedResults[0].metadata?.work?.credits?.[1].name, "正确编剧");
  const replay = planReviewedPeopleReportApply(plan.nextCatalog, plan.updatedResults, reviewed);
  assert.equal(replay.updatedResults.length, 0);
  assert.equal(replay.summary.catalogChanged, false);
});

test("rejects a guarded credit replacement after source state drift", () => {
  const movie = result("work-1");
  movie.metadata = {
    ...movie.metadata,
    externalIds: { imdb: "tt0000001" },
    credits: [{ name: "串片演员", department: "acting", source: "wikidata", externalIds: { wikidata: "Q99" } }],
    work: { ...movie.metadata!.work!, externalIds: { imdb: "tt0000001" }, credits: [{ name: "串片演员", department: "acting", source: "wikidata", externalIds: { wikidata: "Q99" } }] }
  };
  const reviewed = report();
  reviewed.proposedCredits[0].credits = [{
    personId,
    name: "正确导演",
    department: "directing",
    source: "wikidata",
    externalIds: { wikidata: "Q10" }
  }];
  reviewed.proposedCredits[0].creditReplacement = {
    mode: "replace-contaminated",
    reason: "cross-work-contamination",
    expectedAssetKey: "asset-work-1",
    expectedSourceCreditCount: 2,
    expectedLinkedPersonIds: [],
    expectedWorkExternalIds: { imdb: "tt0000001" },
    authoritativeSource: "wikidata",
    authoritativeSourceWorkId: "Q1"
  };
  assert.throws(
    () => planReviewedPeopleReportApply(emptyPersonCatalogState(), [movie], reviewed),
    /count guard failed/
  );
});

test("matches voice-actor review credits to legacy actor rows without appending duplicates", () => {
  const movie = result("work-1");
  const sourceCredits: MovieCreditEntry[] = [{ name: "奥利维娅·科尔曼", department: "acting", job: "Actor", source: "tmdb" }];
  movie.metadata = { ...movie.metadata, credits: structuredClone(sourceCredits), work: { ...movie.metadata!.work!, credits: structuredClone(sourceCredits) } };
  const reviewed = report();
  reviewed.proposedProfiles[0].names[0].value = "奥利维娅·科尔曼";
  reviewed.proposedCredits[0].credits = [{ personId, name: "奥利维娅·科尔曼", department: "acting", job: "Voice Actor", source: "wikidata", externalIds: { wikidata: "Q7088045" } }];
  const plan = planReviewedPeopleReportApply(emptyPersonCatalogState(), [movie], reviewed);
  assert.equal(plan.summary.linkedCreditCount, 1);
  assert.equal(plan.updatedResults[0].metadata?.work?.credits?.length, 1);
  assert.equal(plan.updatedResults[0].metadata?.work?.credits?.[0].personId, personId);
});

test("uses an unmaterialized discovery profile alias to avoid duplicate credits", () => {
  const movie = result("work-1");
  const sourceCredits: MovieCreditEntry[] = [
    { name: "P!nk", department: "acting", job: "Actor", source: "notion" }
  ];
  movie.metadata = {
    ...movie.metadata,
    credits: structuredClone(sourceCredits),
    work: { ...movie.metadata!.work!, credits: structuredClone(sourceCredits) }
  };
  const reviewed = report();
  reviewed.proposedProfiles = [];
  reviewed.creditIdentityProfiles = [{
    ...structuredClone(profile),
    personId: "person_223e4567-e89b-42d3-a456-426614174001",
    names: [
      { value: "Pink", kind: "display", source: "wikidata", status: "strong", observedAt: "2026-08-10T00:00:00.000Z" },
      { value: "P!nk", kind: "alternate", source: "wikidata", status: "strong", observedAt: "2026-08-10T00:00:00.000Z" }
    ],
    externalIds: { wikidata: "Q160009" }
  }];
  reviewed.proposedCredits[0].credits = [{
    name: "Pink",
    originalName: "Pink",
    department: "acting",
    job: "Voice Actor",
    source: "wikidata",
    externalIds: { wikidata: "Q160009" }
  }];
  const plan = planReviewedPeopleReportApply(emptyPersonCatalogState(), [movie], reviewed);
  assert.equal(plan.summary.linkedCreditCount, 0);
  assert.equal(plan.summary.unlinkedCreditCount, 1);
  assert.equal(plan.updatedResults.length, 0);
  assert.equal(movie.metadata?.work?.credits?.length, 1);
  assert.equal(movie.metadata?.work?.credits?.[0].name, "P!nk");
});

test("preserves distinct reviewed role rows when no canonical source row exists", () => {
  const reviewed = report();
  reviewed.proposedCredits[0].credits = [
    { personId, name: "张三", department: "directing", job: "Director", source: "wikidata", externalIds: { wikidata: "Q10" } },
    { personId, name: "张三", department: "production", job: "Producer", source: "wikidata", externalIds: { wikidata: "Q10" } }
  ];
  const plan = planReviewedPeopleReportApply(emptyPersonCatalogState(), [result("work-1")], reviewed);
  assert.equal(plan.summary.linkedCreditCount, 2);
  assert.equal(plan.updatedResults[0].metadata?.work?.credits?.length, 2);
  assert.deepEqual(
    plan.updatedResults[0].metadata?.work?.credits?.map((credit) => credit.department),
    ["directing", "production"]
  );
});

test("clears the stale missing-credits marker when reviewed credits are published", () => {
  const movie = result("work-1");
  const existingCredits = structuredClone(report().proposedCredits[0].credits);
  movie.metadata = {
    ...movie.metadata,
    credits: existingCredits,
    externalIds: { tmdb: "100" },
    dataQuality: { status: "draft", missing: ["credits"], updatedAt: "2026-08-01T00:00:00.000Z" },
    work: {
      ...movie.metadata!.work!,
      credits: existingCredits,
      externalIds: { tmdb: "100" },
      dataQuality: { status: "draft", missing: ["credits"], updatedAt: "2026-08-01T00:00:00.000Z" }
    }
  };
  const plan = planReviewedPeopleReportApply(
    emptyPersonCatalogState(),
    [movie],
    report(),
    "2026-08-10T01:00:00.000Z"
  );
  assert.deepEqual(plan.updatedResults[0].metadata?.dataQuality?.missing, []);
  assert.equal(plan.updatedResults[0].metadata?.dataQuality?.status, "partial");
  assert.deepEqual(plan.updatedResults[0].metadata?.work?.dataQuality?.missing, []);
  assert.equal(plan.updatedResults[0].metadata?.work?.dataQuality?.status, "partial");
});

test("rejects missing search work and unresolved identity issues before writes", () => {
  assert.throws(() => planReviewedPeopleReportApply(emptyPersonCatalogState(), [], report()), /exactly one search result/);
  const unsafe = report();
  unsafe.identityIssues.push({ kind: "external_id_conflict", message: "conflict", personIds: [personId] });
  assert.throws(() => planReviewedPeopleReportApply(emptyPersonCatalogState(), [result("work-1")], unsafe), /identity issue/);
});

test("publishes complete metadata-only people relations without inventing a search-index row", () => {
  const reviewed = report();
  reviewed.proposedCredits[0] = {
    ...reviewed.proposedCredits[0],
    workId: "wwm_metadata_only",
    title: "资料作品",
    sourceWorkExternalIds: { imdb: "tt0000001" },
    metadataOnlyWork: {
      mode: "metadata-only",
      sourcePageId: "3d720ac1-2f0a-8150-a992-cd49d28c1781",
      completeCreditSet: true
    }
  };
  const plan = planReviewedPeopleReportApply(emptyPersonCatalogState(), [], reviewed);
  assert.equal(plan.updatedResults.length, 0);
  assert.equal(plan.summary.linkedCreditCount, 1);
  assert.equal(plan.summary.unlinkedCreditCount, 0);
  assert.equal(plan.nextCatalog.creditsByWorkId.wwm_metadata_only[0].personId, personId);
  assert.equal(plan.nextCatalog.creditsByPersonId[personId][0].workTitle, "资料作品");
});

test("metadata-only publication rejects ledger IDs and incomplete credit sets", () => {
  const reviewed = report();
  reviewed.proposedCredits[0].metadataOnlyWork = {
    mode: "metadata-only",
    sourcePageId: "3d720ac1-2f0a-8150-a992-cd49d28c1781",
    completeCreditSet: true
  };
  reviewed.proposedCredits[0].sourceWorkExternalIds = { imdb: "tt0000001" };
  assert.throws(
    () => planReviewedPeopleReportApply(emptyPersonCatalogState(), [], reviewed),
    /stable wwm_\* work ID/
  );

  reviewed.proposedCredits[0].workId = "wwm_metadata_only";
  reviewed.proposedCredits[0].credits[0].personId = undefined;
  assert.throws(
    () => planReviewedPeopleReportApply(emptyPersonCatalogState(), [], reviewed),
    /non-empty, fully linked credit set/
  );
});

test("rejects a discovery report whose source work identity conflicts with the canonical work", () => {
  const movie = result("work-1");
  movie.metadata = {
    ...movie.metadata,
    externalIds: { imdb: "tt0000001", tmdb: "100" },
    work: { ...movie.metadata!.work!, externalIds: { imdb: "tt0000001", tmdb: "100" } }
  };
  const wrongWork = report();
  wrongWork.proposedCredits[0].sourceWorkExternalIds = { imdb: "tt9999999", tmdb: "999" };
  assert.throws(
    () => planReviewedPeopleReportApply(emptyPersonCatalogState(), [movie], wrongWork),
    /Source work identity conflict for imdb/
  );
});

test("rolls search index back when catalog replacement fails", async () => {
  const plan = planReviewedPeopleReportApply(emptyPersonCatalogState(), [result("work-1")], report());
  const writes: SearchResult[][] = [];
  await assert.rejects(() => applyPersonCatalogPlan({
    plan,
    searchStore: { async upsertResults(values) { writes.push(structuredClone(values)); } },
    personStore: { async replaceState() { throw new Error("catalog failed"); } }
  }), /catalog failed/);
  assert.equal(writes.length, 2);
  assert.equal(writes[0][0].metadata?.work?.credits?.[0].personId, personId);
  assert.equal(writes[1][0].metadata?.work?.credits, undefined);
});

test("empty plan performs no writes", async () => {
  const plan = planReviewedPeopleReportApply(emptyPersonCatalogState(), [], {
    generatedAt: "2026-08-10T00:00:00.000Z", proposedProfiles: [], proposedCredits: [], identityIssues: []
  });
  let writes = 0;
  await applyPersonCatalogPlan({ plan, searchStore: { async upsertResults() { writes += 1; } }, personStore: { async replaceState() { writes += 1; } } });
  assert.equal(writes, 0);
});

test("replaying an already applied report performs no writes", async () => {
  const first = planReviewedPeopleReportApply(emptyPersonCatalogState(), [result("work-1")], report(), "2026-08-10T01:00:00.000Z");
  const appliedResult = first.updatedResults[0];
  const replay = planReviewedPeopleReportApply(first.nextCatalog, [appliedResult], report(), "2026-08-10T02:00:00.000Z");
  assert.equal(replay.summary.catalogChanged, false);
  assert.equal(replay.updatedResults.length, 0);
  let writes = 0;
  await applyPersonCatalogPlan({ plan: replay, searchStore: { async upsertResults() { writes += 1; } }, personStore: { async replaceState() { writes += 1; } } });
  assert.equal(writes, 0);
});

test("replaying a reviewed report preserves the authoritative Notion editorial overlay", () => {
  const pilot = report();
  pilot.proposedProfiles[0].biography = {
    texts: [{
      value: "外部审核版本",
      language: "zh-CN",
      source: "wikidata",
      status: "verified",
      method: "editorial-rewrite",
      observedAt: "2026-08-10T00:00:00.000Z"
    }]
  };
  const first = planReviewedPeopleReportApply(emptyPersonCatalogState(), [result("work-1")], pilot, "2026-08-10T01:00:00.000Z");
  const synced = structuredClone(first.nextCatalog);
  const syncedProfile = synced.people[personId].profile;
  const editedAt = "2026-08-10T01:30:00.000Z";
  syncedProfile.names.unshift({
    value: "张三",
    language: "zh-CN",
    kind: "display",
    source: "notion",
    status: "verified",
    sourceRef: "page-1",
    observedAt: editedAt
  });
  syncedProfile.names.push({
    value: "A later enriched alias",
    language: "en",
    kind: "alternate",
    source: "wikidata",
    status: "strong",
    observedAt: editedAt
  });
  syncedProfile.biography = {
    ...syncedProfile.biography,
    texts: [
      {
        value: "Notion 权威编辑版本",
        language: "zh-CN",
        source: "notion",
        status: "verified",
        method: "editorial-rewrite",
        sourceRef: "page-1",
        observedAt: editedAt
      },
      {
        value: "Supplemental source description",
        language: "zh-CN",
        source: "wikidata",
        status: "strong",
        sourceRef: "https://www.wikidata.org/wiki/Q1",
        observedAt: editedAt
      }
    ]
  };
  syncedProfile.sourceRefs = [{ source: "notion", id: "page-1", observedAt: editedAt }];
  syncedProfile.lockedFields = ["biographyZh"];
  syncedProfile.dataQuality.updatedAt = editedAt;
  syncedProfile.updatedAt = editedAt;
  synced.people[personId].updatedAt = editedAt;
  rebuildDerivedPersonIndexes(synced);

  const replay = planReviewedPeopleReportApply(synced, [first.updatedResults[0]], pilot, "2026-08-10T02:00:00.000Z");
  assert.equal(replay.summary.catalogChanged, false);
  assert.equal(replay.updatedResults.length, 0);
  assert.equal(replay.nextCatalog.people[personId].profile.names[0].source, "notion");
  assert.ok(replay.nextCatalog.people[personId].profile.names.some((entry) => entry.value === "A later enriched alias"));
  assert.deepEqual(replay.nextCatalog.people[personId].profile.biography?.texts, syncedProfile.biography.texts);
  assert.deepEqual(replay.nextCatalog.people[personId].profile.lockedFields, ["biographyZh"]);
});

test("a reviewed biography repair fills a missing language without overwriting Notion", () => {
  const current = emptyPersonCatalogState();
  const notionProfile = structuredClone(profile);
  notionProfile.sourceRefs = [{ source: "notion", id: "page-1", observedAt: profile.updatedAt }];
  notionProfile.biography = {
    texts: [{
      value: "English reviewed biography with enough substantive detail for the quality gate.",
      language: "en",
      source: "notion",
      status: "verified",
      method: "editorial-rewrite",
      observedAt: profile.updatedAt
    }]
  };
  current.people[personId] = { profile: notionProfile, workIds: [], updatedAt: profile.updatedAt };
  const reviewed = report();
  reviewed.proposedProfiles[0].biography = {
    texts: [
      {
        value: "这是一段经过审阅的中文人物简介，说明其职业经历、代表性工作和创作特点，并且保留足够的事实细节，便于读者理解其在影视制作中的位置。",
        language: "zh-CN",
        source: "manual",
        status: "verified",
        method: "editorial-rewrite",
        observedAt: profile.updatedAt
      },
      {
        value: "English reviewed biography with enough substantive detail for the quality gate.",
        language: "en",
        source: "manual",
        status: "verified",
        method: "editorial-rewrite",
        observedAt: profile.updatedAt
      }
    ]
  };
  const plan = planReviewedPeopleReportApply(current, [result("work-1")], reviewed, "2026-08-10T02:00:00.000Z");
  const texts = plan.nextCatalog.people[personId].profile.biography?.texts ?? [];
  assert.equal(texts.filter((entry) => entry.language === "zh-CN").length, 1);
  assert.equal(texts.find((entry) => entry.language === "en")?.source, "notion");
  assert.equal(plan.summary.catalogChanged, true);
});
