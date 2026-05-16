import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../components/Button/Button";
import { Modal } from "../../../components/Modal/Modal";
import { providerLabel, type CostEstimate } from "../../../ipc/ai";
import styles from "./CostPreviewModal.module.css";

type Props = {
  estimate: CostEstimate;
  prompt: string;
  onSend: (dontAsk: boolean) => void;
  onCancel: () => void;
};

export const CostPreviewModal = ({
  estimate,
  prompt,
  onSend,
  onCancel,
}: Props) => {
  const { t } = useTranslation();
  const [dontAsk, setDontAsk] = useState(false);
  return (
    <Modal
      open={true}
      onClose={onCancel}
      title={t("ai.costPreviewTitle")}
      size="md"
      footer={
        <>
          <Button onClick={onCancel}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => onSend(dontAsk)}>
            {t("ai.send")}
          </Button>
        </>
      }
    >
      <dl className={styles.list}>
        <dt>{t("ai.provider", { defaultValue: "Provider" })}</dt>
        <dd>{providerLabel(estimate.provider) ?? estimate.provider}</dd>
        <dt>{t("ai.model")}</dt>
        <dd>{estimate.model}</dd>
        <dt>{t("ai.estimatedTokens")}</dt>
        <dd>
          {estimate.estimatedInputTokens.toLocaleString()} in /{" "}
          {estimate.estimatedOutputTokens.toLocaleString()} out
        </dd>
        <dt>{t("ai.estimatedCost")}</dt>
        <dd>~${estimate.estimatedUsd.toFixed(4)}</dd>
        <dt>{t("ai.pricing", { defaultValue: "Pricing" })}</dt>
        <dd>
          {estimate.pricingKnown
            ? `${estimate.textInputUsdPerMillion.toFixed(2)} in / ${estimate.audioInputUsdPerMillion.toFixed(2)} audio / ${estimate.outputUsdPerMillion.toFixed(2)} out per 1M`
            : t("ai.pricingUnknown", { defaultValue: "No built-in pricing metadata for this model" })}
        </dd>
      </dl>
      {prompt && (
        <details className={styles.details}>
          <summary>{t("ai.showPrompt")}</summary>
          <pre className={styles.prompt}>{prompt}</pre>
        </details>
      )}
      <label className={styles.dontAsk}>
        <input
          type="checkbox"
          checked={dontAsk}
          onChange={(e) => setDontAsk(e.target.checked)}
        />
        {t("ai.dontAskAgain")}
      </label>
    </Modal>
  );
};
