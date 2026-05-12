import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAtom } from "jotai";
import {
  codebookTree as fetchTree,
  clusterCreate,
  clusterRename,
  clusterDelete,
  categoryCreate,
  categoryRename,
  categoryDelete,
  tagCreate,
  tagRename,
  tagDelete,
  type ClusterNode,
  type CategoryNode,
  type TagNode,
} from "../../../ipc/codebook";
import {
  codebookTreeAtom,
  selectedCodebookNodeAtom,
  type SelectedCodebookNode,
} from "../../../state/codebook";
import styles from "./CodebookTree.module.css";

type SelectFn = (s: SelectedCodebookNode) => void;
type MutateFn = () => Promise<void>;
type ErrorFn = (e: unknown) => void;

export const CodebookTree = () => {
  const { t } = useTranslation();
  const [tree, setTree] = useAtom(codebookTreeAtom);
  const [selected, setSelected] = useAtom(selectedCodebookNodeAtom);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => setTree(await fetchTree());

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleError: ErrorFn = (e) => {
    const msg = String((e as { message?: string })?.message ?? e);
    if (msg.includes("Conflict") || msg.includes("already exists"))
      setError(t("codebook.errorDuplicate"));
    else if (
      msg.includes("in use") ||
      msg.includes("has tags") ||
      msg.includes("is in use")
    )
      setError(t("codebook.errorInUse"));
    else setError(msg);
  };

  const onAddCluster = async () => {
    setError(null);
    const name = window.prompt(t("codebook.nameCluster"));
    if (!name) return;
    try {
      await clusterCreate(name);
      await reload();
    } catch (e) {
      handleError(e);
    }
  };

  return (
    <div className={styles.wrap}>
      <button className={styles.addBtn} onClick={() => void onAddCluster()}>
        {t("codebook.addCluster")}
      </button>
      {error && <div className={styles.error}>{error}</div>}
      {tree?.clusters.map((c) => (
        <ClusterRow
          key={c.id}
          cluster={c}
          selected={selected}
          onSelect={setSelected}
          onMutate={reload}
          onError={handleError}
        />
      ))}
    </div>
  );
};

type ClusterRowProps = {
  cluster: ClusterNode;
  selected: SelectedCodebookNode;
  onSelect: SelectFn;
  onMutate: MutateFn;
  onError: ErrorFn;
};

const ClusterRow = ({
  cluster,
  selected,
  onSelect,
  onMutate,
  onError,
}: ClusterRowProps) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cluster.name);

  const submit = async () => {
    if (draft.trim() && draft !== cluster.name) {
      try {
        await clusterRename(cluster.id, draft.trim());
        await onMutate();
      } catch (e) {
        onError(e);
      }
    }
    setEditing(false);
  };

  const del = async () => {
    if (!window.confirm(t("codebook.confirmDelete", { name: cluster.name })))
      return;
    try {
      await clusterDelete(cluster.id);
      await onMutate();
    } catch (e) {
      onError(e);
    }
  };

  const addCategory = async () => {
    const name = window.prompt(t("codebook.nameCategory"));
    if (!name) return;
    try {
      await categoryCreate(cluster.id, name);
      await onMutate();
    } catch (e) {
      onError(e);
    }
  };

  const isSelected = selected?.kind === "cluster" && selected.id === cluster.id;

  return (
    <div className={styles.cluster}>
      <div className={`${styles.row} ${isSelected ? styles.selected : ""}`}>
        <button
          className={styles.chevron}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "▾" : "▸"}
        </button>
        {editing ? (
          <input
            className={styles.input}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void submit()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              if (e.key === "Escape") {
                setDraft(cluster.name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            className={styles.label}
            onClick={() => onSelect({ kind: "cluster", id: cluster.id })}
            onDoubleClick={() => {
              setDraft(cluster.name);
              setEditing(true);
            }}
          >
            {cluster.color && (
              <span
                className={styles.swatch}
                style={{ background: cluster.color }}
              />
            )}
            {cluster.name}
            <span className={styles.count}>({cluster.count})</span>
          </button>
        )}
        <button
          className={styles.delBtn}
          onClick={() => void del()}
          title={t("codebook.delete")}
        >
          ×
        </button>
      </div>
      {expanded && (
        <>
          {cluster.categories.map((cat) => (
            <CategoryRow
              key={cat.id}
              category={cat}
              selected={selected}
              onSelect={onSelect}
              onMutate={onMutate}
              onError={onError}
            />
          ))}
          <button
            className={styles.addNested}
            onClick={() => void addCategory()}
          >
            {t("codebook.addCategory")}
          </button>
        </>
      )}
    </div>
  );
};

type CategoryRowProps = {
  category: CategoryNode;
  selected: SelectedCodebookNode;
  onSelect: SelectFn;
  onMutate: MutateFn;
  onError: ErrorFn;
};

const CategoryRow = ({
  category,
  selected,
  onSelect,
  onMutate,
  onError,
}: CategoryRowProps) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(category.name);

  const submit = async () => {
    if (draft.trim() && draft !== category.name) {
      try {
        await categoryRename(category.id, draft.trim());
        await onMutate();
      } catch (e) {
        onError(e);
      }
    }
    setEditing(false);
  };

  const del = async () => {
    if (!window.confirm(t("codebook.confirmDelete", { name: category.name })))
      return;
    try {
      await categoryDelete(category.id);
      await onMutate();
    } catch (e) {
      onError(e);
    }
  };

  const addTag = async () => {
    const name = window.prompt(t("codebook.nameTag"));
    if (!name) return;
    try {
      await tagCreate(category.id, name);
      await onMutate();
    } catch (e) {
      onError(e);
    }
  };

  const isSelected =
    selected?.kind === "category" && selected.id === category.id;

  return (
    <div className={styles.category}>
      <div className={`${styles.row} ${isSelected ? styles.selected : ""}`}>
        <button
          className={styles.chevron}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "▾" : "▸"}
        </button>
        {editing ? (
          <input
            className={styles.input}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void submit()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              if (e.key === "Escape") {
                setDraft(category.name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            className={styles.label}
            onClick={() => onSelect({ kind: "category", id: category.id })}
            onDoubleClick={() => {
              setDraft(category.name);
              setEditing(true);
            }}
          >
            {category.color && (
              <span
                className={styles.swatch}
                style={{ background: category.color }}
              />
            )}
            {category.name}
            <span className={styles.count}>({category.count})</span>
          </button>
        )}
        <button
          className={styles.delBtn}
          onClick={() => void del()}
          title={t("codebook.delete")}
        >
          ×
        </button>
      </div>
      {expanded && (
        <>
          {category.tags.map((tag) => (
            <TagRow
              key={tag.id}
              tag={tag}
              selected={selected}
              onSelect={onSelect}
              onMutate={onMutate}
              onError={onError}
            />
          ))}
          <button className={styles.addNested} onClick={() => void addTag()}>
            {t("codebook.addTag")}
          </button>
        </>
      )}
    </div>
  );
};

type TagRowProps = {
  tag: TagNode;
  selected: SelectedCodebookNode;
  onSelect: SelectFn;
  onMutate: MutateFn;
  onError: ErrorFn;
};

const TagRow = ({ tag, selected, onSelect, onMutate, onError }: TagRowProps) => {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tag.name);

  const submit = async () => {
    if (draft.trim() && draft !== tag.name) {
      try {
        await tagRename(tag.id, draft.trim());
        await onMutate();
      } catch (e) {
        onError(e);
      }
    }
    setEditing(false);
  };

  const del = async () => {
    if (!window.confirm(t("codebook.confirmDelete", { name: tag.name }))) return;
    try {
      await tagDelete(tag.id);
      await onMutate();
    } catch (e) {
      onError(e);
    }
  };

  const isSelected = selected?.kind === "tag" && selected.id === tag.id;

  return (
    <div className={`${styles.tagRow} ${isSelected ? styles.selected : ""}`}>
      {editing ? (
        <input
          className={styles.input}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void submit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") {
              setDraft(tag.name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          className={styles.label}
          onClick={() => onSelect({ kind: "tag", id: tag.id })}
          onDoubleClick={() => {
            setDraft(tag.name);
            setEditing(true);
          }}
        >
          {tag.color && (
            <span
              className={styles.swatch}
              style={{ background: tag.color }}
            />
          )}
          {tag.name}
          <span className={styles.count}>({tag.count})</span>
        </button>
      )}
      <button
        className={styles.delBtn}
        onClick={() => void del()}
        title={t("codebook.delete")}
      >
        ×
      </button>
    </div>
  );
};
