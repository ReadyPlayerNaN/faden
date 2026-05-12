import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAtom } from "jotai";
import {
  interviewList as fetchList,
  interviewCreate,
} from "../../../ipc/interview";
import {
  interviewListAtom,
  selectedInterviewIdAtom,
} from "../../../state/interview";
import { Button } from "../../../components/Button/Button";
import styles from "./InterviewList.module.css";

export const InterviewList = () => {
  const { t } = useTranslation();
  const [list, setList] = useAtom(interviewListAtom);
  const [selected, setSelected] = useAtom(selectedInterviewIdAtom);

  useEffect(() => {
    void fetchList().then(setList);
  }, [setList]);

  const onAdd = async () => {
    const name = window.prompt(t("workspace.newInterviewPrompt"));
    if (!name) return;
    const created = await interviewCreate(name);
    setList([...list, created]);
    setSelected(created.id);
  };

  return (
    <div className={styles.wrap}>
      <Button onClick={() => void onAdd()}>{t("workspace.addInterview")}</Button>
      {list.length === 0 ? (
        <p className={styles.empty}>{t("workspace.noInterviews")}</p>
      ) : (
        <ul className={styles.list}>
          {list.map((i) => (
            <li key={i.id}>
              <button
                className={`${styles.item} ${selected === i.id ? styles.selected : ""}`}
                onClick={() => setSelected(i.id)}
              >
                {i.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
