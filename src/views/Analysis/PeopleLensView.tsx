import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorBanner } from "../../components/ErrorBanner";
import { PageViewHeader } from "../../components/PageViewHeader/PageViewHeader";
import type { Person } from "../../ipc/person";
import { useAnalysisData, type AnalysisItem } from "./AnalysisData";
import styles from "./PeopleLensView.module.css";

type Granularity = "cluster" | "category" | "tag";
type GroupBy = "none" | "interview" | "link-status" | "contact";
type SortBy = "salience" | "coverage" | "contrast";

type ThemeCount = {
  key: string;
  label: string;
  count: number;
};

type ParticipantSummary = {
  key: string;
  name: string;
  kind: "person" | "speaker" | "unknown";
  linked: boolean;
  person: Person | null;
  interviewIds: number[];
  interviewNames: string[];
  codedQuotes: number;
  memoCount: number;
  coverage: number;
  contrast: number;
  topThemes: ThemeCount[];
  evidenceItems: AnalysisItem[];
};

type ParticipantBucket = {
  key: string;
  label: string;
  participants: ParticipantSummary[];
};

type MutableParticipant = {
  key: string;
  name: string;
  kind: "person" | "speaker" | "unknown";
  linked: boolean;
  person: Person | null;
  interviewIds: Set<number>;
  interviewNames: Set<string>;
  codedQuotes: number;
  memoCount: number;
  evidenceItems: AnalysisItem[];
  themeCounts: Map<string, ThemeCount>;
  themeMentionTotal: number;
};

const clampRatio = (value: number) => {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const compareNames = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

const topThemeLabels = (participant: ParticipantSummary) => participant.topThemes.slice(0, 3);

export const PeopleLensView = () => {
  const { t } = useTranslation();
  const {
    interviews,
    evidenceItems,
    people,
    speakersByInterview,
    segmentsByInterview,
    loading,
    error,
  } = useAnalysisData();

  const [granularity, setGranularity] = useState<Granularity>("category");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [sortBy, setSortBy] = useState<SortBy>("salience");
  const [selectedParticipantKey, setSelectedParticipantKey] = useState<string | null>(null);

  const participantSummaries = useMemo<ParticipantSummary[]>(() => {
    const interviewNameById = new Map(interviews.map((interview) => [interview.id, interview.name]));
    const mutable = new Map<string, MutableParticipant>();

    for (const item of evidenceItems) {
      const segment = segmentsByInterview.get(item.interview.id)?.get(item.span.segmentId) ?? null;
      const speaker = segment?.speakerId
        ? (speakersByInterview.get(item.interview.id)?.get(segment.speakerId) ?? null)
        : null;
      const person = speaker?.personId
        ? (people.find((entry) => entry.id === speaker.personId) ?? null)
        : null;

      const fallbackSpeakerName =
        speaker?.effectiveName?.trim() ||
        segment?.speakerDisplayName?.trim() ||
        segment?.speakerLabelRaw?.trim() ||
        t("analysis.peopleLens.unknownSpeaker", { defaultValue: "Unknown speaker" });

      const participantKey = person
        ? `person:${person.id}`
        : speaker
          ? `speaker:${item.interview.id}:${speaker.id}`
          : `unknown:${item.interview.id}:${fallbackSpeakerName}`;

      const participant = mutable.get(participantKey) ?? {
        key: participantKey,
        name: person?.name ?? fallbackSpeakerName,
        kind: person ? "person" : speaker ? "speaker" : "unknown",
        linked: Boolean(person),
        person,
        interviewIds: new Set<number>(),
        interviewNames: new Set<string>(),
        codedQuotes: 0,
        memoCount: 0,
        evidenceItems: [],
        themeCounts: new Map<string, ThemeCount>(),
        themeMentionTotal: 0,
      };

      participant.interviewIds.add(item.interview.id);
      participant.interviewNames.add(interviewNameById.get(item.interview.id) ?? item.interview.name);
      participant.codedQuotes += 1;
      if (item.span.memo?.trim()) participant.memoCount += 1;
      participant.evidenceItems.push(item);

      const themesForSpan = new Map<string, ThemeCount>();
      for (const meta of item.tagMetas) {
        const theme =
          granularity === "cluster"
            ? meta.cluster
              ? {
                  key: `cluster:${meta.cluster.id}`,
                  label: meta.cluster.name,
                  count: 0,
                }
              : {
                  key: "cluster:none",
                  label: t("analysis.peopleLens.unclustered", { defaultValue: "Unclustered" }),
                  count: 0,
                }
            : granularity === "category"
              ? meta.category
                ? {
                    key: `category:${meta.category.id}`,
                    label: meta.cluster
                      ? `${meta.cluster.name} › ${meta.category.name}`
                      : meta.category.name,
                    count: 0,
                  }
                : {
                    key: "category:none",
                    label: t("analysis.peopleLens.uncategorized", { defaultValue: "Uncategorized" }),
                    count: 0,
                  }
              : {
                  key: `tag:${meta.tag.id}`,
                  label:
                    meta.category && meta.cluster
                      ? `${meta.cluster.name} › ${meta.category.name} › ${meta.tag.name}`
                      : meta.category
                        ? `${meta.category.name} › ${meta.tag.name}`
                        : meta.tag.name,
                  count: 0,
                };
        themesForSpan.set(theme.key, theme);
      }

      for (const theme of themesForSpan.values()) {
        const existing = participant.themeCounts.get(theme.key);
        if (existing) {
          existing.count += 1;
        } else {
          participant.themeCounts.set(theme.key, { ...theme, count: 1 });
        }
        participant.themeMentionTotal += 1;
      }

      mutable.set(participantKey, participant);
    }

    return Array.from(mutable.values())
      .map<ParticipantSummary>((participant) => {
        const topThemes = Array.from(participant.themeCounts.values()).sort(
          (a, b) => b.count - a.count || compareNames(a.label, b.label),
        );
        const contrast = participant.themeMentionTotal > 0
          ? (topThemes[0]?.count ?? 0) / participant.themeMentionTotal
          : 0;

        return {
          key: participant.key,
          name: participant.name,
          kind: participant.kind,
          linked: participant.linked,
          person: participant.person,
          interviewIds: Array.from(participant.interviewIds.values()).sort((a, b) => a - b),
          interviewNames: Array.from(participant.interviewNames.values()).sort(compareNames),
          codedQuotes: participant.codedQuotes,
          memoCount: participant.memoCount,
          coverage: topThemes.length,
          contrast: clampRatio(contrast),
          topThemes,
          evidenceItems: participant.evidenceItems.sort(
            (a, b) => a.interview.name.localeCompare(b.interview.name) || a.span.segmentId - b.span.segmentId,
          ),
        };
      })
      .sort((a, b) => {
        if (sortBy === "coverage") {
          return b.coverage - a.coverage || b.codedQuotes - a.codedQuotes || compareNames(a.name, b.name);
        }
        if (sortBy === "contrast") {
          return b.contrast - a.contrast || b.codedQuotes - a.codedQuotes || compareNames(a.name, b.name);
        }
        return b.codedQuotes - a.codedQuotes || b.coverage - a.coverage || compareNames(a.name, b.name);
      });
  }, [evidenceItems, granularity, interviews, people, sortBy, speakersByInterview, segmentsByInterview, t]);

  useEffect(() => {
    if (participantSummaries.length === 0) {
      setSelectedParticipantKey(null);
      return;
    }
    if (!selectedParticipantKey || !participantSummaries.some((participant) => participant.key === selectedParticipantKey)) {
      setSelectedParticipantKey(participantSummaries[0].key);
    }
  }, [participantSummaries, selectedParticipantKey]);

  const groupedParticipants = useMemo<ParticipantBucket[]>(() => {
    const groups = new Map<string, ParticipantBucket>();

    for (const participant of participantSummaries) {
      const placements =
        groupBy === "interview"
          ? (participant.interviewNames.length > 0 ? participant.interviewNames : [t("analysis.peopleLens.unknownInterview", { defaultValue: "Unknown interview" })]).map((name) => ({
              key: `interview:${name}`,
              label: name,
            }))
          : groupBy === "link-status"
            ? [participant.linked
                ? {
                    key: "linked",
                    label: t("analysis.peopleLens.groupLinked", { defaultValue: "Linked people" }),
                  }
                : {
                    key: "unlinked",
                    label: t("analysis.peopleLens.groupUnlinked", { defaultValue: "Unlinked speakers" }),
                  }]
            : groupBy === "contact"
              ? [participant.person?.email || participant.person?.phone
                  ? {
                      key: "contact:yes",
                      label: t("analysis.peopleLens.groupHasContact", { defaultValue: "Has contact details" }),
                    }
                  : {
                      key: "contact:no",
                      label: t("analysis.peopleLens.groupNoContact", { defaultValue: "No contact details" }),
                    }]
              : [{
                  key: "all",
                  label: t("analysis.peopleLens.groupAll", { defaultValue: "All participants" }),
                }];

      for (const placement of placements) {
        const bucket = groups.get(placement.key) ?? {
          key: placement.key,
          label: placement.label,
          participants: [],
        };
        bucket.participants.push(participant);
        groups.set(placement.key, bucket);
      }
    }

    return Array.from(groups.values()).sort((a, b) => compareNames(a.label, b.label));
  }, [groupBy, participantSummaries, t]);

  const selectedParticipant = participantSummaries.find((participant) => participant.key === selectedParticipantKey) ?? null;
  const linkedCount = participantSummaries.filter((participant) => participant.linked).length;
  const unlinkedCount = participantSummaries.length - linkedCount;

  return (
    <>
      <PageViewHeader
        view="analysis"
        title={t("analysis.peopleLens.title", { defaultValue: "People lens" })}
        subtitle={t("analysis.peopleLens.subtitle", {
          defaultValue:
            "See the analysis from the participant side: who carries which themes, where evidence clusters, and where memos already exist.",
        })}
        aside={
          <div className={styles.summaryCard}>
            <strong>{participantSummaries.length}</strong>
            <span>
              {t("analysis.peopleLens.summary", {
                count: participantSummaries.length,
                defaultValue: "{{count}} participants with coded evidence",
              })}
            </span>
          </div>
        }
      />

      {error ? <ErrorBanner message={error} onDismiss={() => undefined} /> : null}

      <section className={styles.explainerCard}>
        <p className={styles.explainerText}>
          {t("analysis.peopleLens.readOnlyHint", {
            defaultValue:
              "This lens is read-only for now. Link speakers to People and keep coding interviews to make participant patterns easier to compare here.",
          })}
        </p>
        <div className={styles.metrics}>
          <span>
            {t("analysis.peopleLens.metricLinked", {
              count: linkedCount,
              defaultValue: "Linked people: {{count}}",
            })}
          </span>
          <span>
            {t("analysis.peopleLens.metricUnlinked", {
              count: unlinkedCount,
              defaultValue: "Unlinked speakers: {{count}}",
            })}
          </span>
          <span>
            {t("analysis.peopleLens.metricQuotes", {
              count: evidenceItems.length,
              defaultValue: "Coded quotes: {{count}}",
            })}
          </span>
        </div>
      </section>

      <section className={styles.controlsCard}>
        <div className={styles.controlsHeader}>
          <h2 className={styles.sectionTitle}>
            {t("analysis.peopleLens.controls", { defaultValue: "Controls" })}
          </h2>
        </div>
        <div className={styles.controlsGrid}>
          <label className={styles.field}>
            <span>{t("analysis.peopleLens.granularity", { defaultValue: "Granularity" })}</span>
            <select value={granularity} onChange={(event) => setGranularity(event.target.value as Granularity)}>
              <option value="cluster">{t("analysis.peopleLens.granularityCluster", { defaultValue: "Cluster" })}</option>
              <option value="category">{t("analysis.peopleLens.granularityCategory", { defaultValue: "Category" })}</option>
              <option value="tag">{t("analysis.peopleLens.granularityTag", { defaultValue: "Tag" })}</option>
            </select>
          </label>

          <label className={styles.field}>
            <span>{t("analysis.peopleLens.groupBy", { defaultValue: "Group by" })}</span>
            <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as GroupBy)}>
              <option value="none">{t("analysis.peopleLens.groupByNone", { defaultValue: "No grouping" })}</option>
              <option value="interview">{t("analysis.peopleLens.groupByInterview", { defaultValue: "Interview" })}</option>
              <option value="link-status">{t("analysis.peopleLens.groupByLinkStatus", { defaultValue: "Link status" })}</option>
              <option value="contact">{t("analysis.peopleLens.groupByContact", { defaultValue: "Contact details" })}</option>
            </select>
          </label>

          <label className={styles.field}>
            <span>{t("analysis.peopleLens.sortBy", { defaultValue: "Sort by" })}</span>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortBy)}>
              <option value="salience">{t("analysis.peopleLens.sortSalience", { defaultValue: "Salience" })}</option>
              <option value="coverage">{t("analysis.peopleLens.sortCoverage", { defaultValue: "Coverage" })}</option>
              <option value="contrast">{t("analysis.peopleLens.sortContrast", { defaultValue: "Contrast" })}</option>
            </select>
          </label>
        </div>
      </section>

      <div className={styles.layout}>
        <section className={styles.participantsCard}>
          {loading ? (
            <p className={styles.empty}>{t("analysis.peopleLens.loading", { defaultValue: "Loading participant summaries…" })}</p>
          ) : participantSummaries.length === 0 ? (
            <p className={styles.empty}>
              {t("analysis.peopleLens.empty", {
                defaultValue: "No coded participant evidence yet. Add speaker assignments and coded transcript spans to populate this view.",
              })}
            </p>
          ) : (
            groupedParticipants.map((bucket) => (
              <section key={bucket.key} className={styles.groupSection}>
                <div className={styles.groupHeader}>
                  <h3 className={styles.groupTitle}>{bucket.label}</h3>
                  <span className={styles.groupCount}>
                    {t("analysis.peopleLens.groupCount", {
                      count: bucket.participants.length,
                      defaultValue: "{{count}} participants",
                    })}
                  </span>
                </div>
                <div className={styles.cardGrid}>
                  {bucket.participants.map((participant) => {
                    const active = participant.key === selectedParticipantKey;
                    return (
                      <button
                        key={participant.key}
                        type="button"
                        className={`${styles.participantCard} ${active ? styles.participantCardActive : ""}`.trim()}
                        onClick={() => setSelectedParticipantKey(participant.key)}
                      >
                        <div className={styles.cardHeader}>
                          <div>
                            <div className={styles.participantName}>{participant.name}</div>
                            <div className={styles.participantMeta}>
                              <span>
                                {participant.linked
                                  ? t("analysis.peopleLens.statusLinked", { defaultValue: "Linked person" })
                                  : t("analysis.peopleLens.statusUnlinked", { defaultValue: "Unlinked speaker" })}
                              </span>
                              <span>•</span>
                              <span>
                                {t("analysis.peopleLens.interviewsCount", {
                                  count: participant.interviewIds.length,
                                  defaultValue: "Interviews: {{count}}",
                                })}
                              </span>
                            </div>
                          </div>
                          <div className={styles.quotePill}>{participant.codedQuotes}</div>
                        </div>

                        {participant.person?.email || participant.person?.phone ? (
                          <div className={styles.contactMeta}>
                            {participant.person.email ? <span>{participant.person.email}</span> : null}
                            {participant.person.phone ? <span>{participant.person.phone}</span> : null}
                          </div>
                        ) : null}

                        <div className={styles.metricRow}>
                          <span>
                            {t("analysis.peopleLens.coverageMetric", {
                              count: participant.coverage,
                              defaultValue: "Themes: {{count}}",
                            })}
                          </span>
                          <span>
                            {t("analysis.peopleLens.memoMetric", {
                              count: participant.memoCount,
                              defaultValue: "Memos: {{count}}",
                            })}
                          </span>
                          <span>
                            {t("analysis.peopleLens.contrastMetric", {
                              percent: Math.round(participant.contrast * 100),
                              defaultValue: "Contrast: {{percent}}%",
                            })}
                          </span>
                        </div>

                        <div className={styles.interviewList}>{participant.interviewNames.join(" · ")}</div>

                        <div className={styles.themeList}>
                          {topThemeLabels(participant).length > 0 ? (
                            topThemeLabels(participant).map((theme) => (
                              <span key={`${participant.key}-${theme.key}`} className={styles.themeChip}>
                                {theme.label} · {theme.count}
                              </span>
                            ))
                          ) : (
                            <span className={styles.noThemes}>
                              {t("analysis.peopleLens.noThemes", { defaultValue: "No themes yet" })}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </section>

        <aside className={styles.detailCard}>
          {selectedParticipant ? (
            <>
              <div className={styles.detailHeader}>
                <div>
                  <h2 className={styles.detailTitle}>{selectedParticipant.name}</h2>
                  <p className={styles.detailSubtitle}>
                    {selectedParticipant.interviewNames.join(" · ")}
                  </p>
                </div>
                <div className={styles.detailStats}>
                  <span>
                    {t("analysis.peopleLens.detailQuotes", {
                      count: selectedParticipant.codedQuotes,
                      defaultValue: "Quotes: {{count}}",
                    })}
                  </span>
                  <span>
                    {t("analysis.peopleLens.detailMemos", {
                      count: selectedParticipant.memoCount,
                      defaultValue: "Memos: {{count}}",
                    })}
                  </span>
                </div>
              </div>

              <section className={styles.detailSection}>
                <h3 className={styles.detailSectionTitle}>
                  {t("analysis.peopleLens.topThemes", { defaultValue: "Top themes" })}
                </h3>
                <div className={styles.detailThemeList}>
                  {selectedParticipant.topThemes.slice(0, 8).map((theme) => (
                    <div key={`${selectedParticipant.key}-${theme.key}`} className={styles.detailThemeRow}>
                      <span>{theme.label}</span>
                      <strong>{theme.count}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className={styles.detailSection}>
                <h3 className={styles.detailSectionTitle}>
                  {t("analysis.peopleLens.filteredEvidence", { defaultValue: "Filtered evidence and memos" })}
                </h3>
                <ul className={styles.evidenceList}>
                  {selectedParticipant.evidenceItems.map((item) => (
                    <li key={`${selectedParticipant.key}-${item.span.id}`} className={styles.evidenceItem}>
                      <div className={styles.evidenceMeta}>
                        <span>{item.interview.name}</span>
                        <span>•</span>
                        <span>
                          {t("analysis.peopleLens.segmentRef", {
                            segmentId: item.span.segmentId,
                            defaultValue: "Segment {{segmentId}}",
                          })}
                        </span>
                      </div>
                      <blockquote className={styles.quote}>{item.span.textSnapshot}</blockquote>
                      <div className={styles.evidenceThemes}>
                        {item.tagMetas.map((meta) => (
                          <span key={`${item.span.id}-${meta.tag.id}`} className={styles.themeChip}>
                            {meta.cluster ? `${meta.cluster.name} › ` : ""}
                            {meta.category ? `${meta.category.name} › ` : ""}
                            {meta.tag.name}
                          </span>
                        ))}
                      </div>
                      {item.span.memo?.trim() ? <p className={styles.memo}>{item.span.memo.trim()}</p> : null}
                    </li>
                  ))}
                </ul>
              </section>
            </>
          ) : (
            <p className={styles.empty}>
              {t("analysis.peopleLens.selectParticipant", {
                defaultValue: "Select a participant to inspect their evidence and memos.",
              })}
            </p>
          )}
        </aside>
      </div>
    </>
  );
};
