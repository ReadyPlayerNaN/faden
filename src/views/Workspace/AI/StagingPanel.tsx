import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtom } from "jotai";
import {
  pendingProposalsAtom,
  activeProposalIdAtom,
} from "../../../state/ai";
import {
  aiProposalList,
  aiProposalReject,
  aiProposalGet,
  type ProposalDTO,
} from "../../../ipc/ai";
import { CodebookProposalView } from "./CodebookProposalView";
import { SpanProposalView } from "./SpanProposalView";
import { Button } from "../../../components/Button/Button";
import { Modal } from "../../../components/Modal/Modal";
import styles from "./StagingPanel.module.css";

export const StagingPanel = () => {
  const { t } = useTranslation();
  const [proposals, setProposals] = useAtom(pendingProposalsAtom);
  const [activeId, setActiveId] = useAtom(activeProposalIdAtom);
  const [active, setActive] = useState<ProposalDTO | null>(null);

  useEffect(() => {
    void aiProposalList().then(setProposals);
  }, [setProposals]);

  useEffect(() => {
    if (activeId === null) {
      setActive(null);
      return;
    }
    void aiProposalGet(activeId).then(setActive);
  }, [activeId]);

  const onReject = async (id: number) => {
    await aiProposalReject(id);
    setProposals(await aiProposalList());
    if (activeId === id) setActiveId(null);
  };

  const onClose = async () => {
    setActiveId(null);
    setProposals(await aiProposalList());
  };

  return (
    <div className={styles.dock}>
      <header className={styles.header}>
        <span>{t("ai.staging", { count: proposals.length })}</span>
      </header>
      {proposals.length === 0 ? (
        <p className={styles.empty}>{t("ai.noProposals")}</p>
      ) : (
        <ul className={styles.list}>
          {proposals.map((p) => (
            <li key={p.id}>
              <span className={styles.kind}>{p.kind}</span>
              <Button onClick={() => setActiveId(p.id)}>
                {t("ai.openProposal")}
              </Button>
              <Button variant="danger" onClick={() => void onReject(p.id)}>
                {t("ai.reject")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={active !== null}
        onClose={() => void onClose()}
        size="lg"
      >
        {active &&
          (active.kind === "codebook_gen" ? (
            <CodebookProposalView
              proposal={active}
              onDone={() => void onClose()}
            />
          ) : (
            <SpanProposalView
              proposal={active}
              onDone={() => void onClose()}
            />
          ))}
      </Modal>
    </div>
  );
};
