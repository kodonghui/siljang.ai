import { type FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CONNECTION_FAILED } from "./api";
import { CopyValue } from "./CopyValue";
import { formatKoreanDateTime } from "./format-date";
import {
  BLOCK_KEYS,
  fetchKakaoChannel,
  type KakaoChannel,
  type KakaoChannelResult,
  rotateKakaoSkillKey,
  type SkillKey,
  saveKakaoChannel,
  startKakaoChannelCheck,
} from "./kakao-channel-api";
import {
  BLOCK_LABELS,
  type ChannelForm,
  channelForm,
  channelIssues,
  channelPayload,
  rebaseChannel,
} from "./kakao-channel-form";
import { classify } from "./problems";
import type { ShopLicenseProps } from "./ShopLicense";
import { Banner, Button, CommandStatus, fieldErrorsFor, LoadFailure, OwnerLayout, Skeleton, TextField } from "./ui";
import { useCommand } from "./useCommand";
import { useVersionedRead } from "./useVersionedRead";
import "./kakao-channel.css";

type Action =
  | { action: "save"; body: Record<string, unknown> }
  | { action: "check" }
  | { action: "rotate"; body: { baseRevision: string; previousKey: "keep_24h" | "revoke_now" } };
type Result = KakaoChannelResult & { action: Action["action"] };
const verifiedNames = {
  card: "card",
  ordererInfo: "orderer_info",
  allergyAnswer: "allergy_answer",
  depositorName: "depositor_name",
  review: "review",
} as const;
const missingHints = {
  card: "card_block",
  ordererInfo: "orderer_block",
  allergyAnswer: "allergy_block",
  depositorName: "depositor_block",
  review: "review_block",
} as const;
const eventReasons = {
  app_not_linked: "가게 채널과 앱 연결을 확인해 주세요",
  wallet_missing: "월렛 연결을 확인해 주세요",
  event_block: "안내 블록의 이벤트 이름과 배포를 확인해 주세요",
  event_skill: "안내 스킬 주소와 헤더를 확인해 주세요",
  owner_not_friend: "가게 채널의 친구인지 확인해 주세요",
  not_delivered: "시험 안내가 닿지 않았어요",
  kakao_error: "카카오에 문제가 생겼어요. 잠시 뒤 다시 확인해 주세요",
};
const fields = ["/botId", "/channelPublicId", ...BLOCK_KEYS.map((key) => `/blockIds/${key}`)];
const skillUrls = [
  ["messageSkillUrl", "메시지 스킬 주소"],
  ["cardSkillUrl", "카드 스킬 주소"],
  ["reviewSkillUrl", "후기 스킬 주소"],
  ["eventSkillUrl", "안내 스킬 주소"],
] as const;
const hints = {
  skill_url: "스킬 주소를 확인해 주세요",
  skill_key_header: "스킬 키 헤더를 확인해 주세요",
  open_builder_deploy: "오픈빌더에 배포했는지 확인해 주세요",
  test_message_missing:
    "연결 문구를 이 채널 대화창에 그대로 보냈는지, 봇 ID가 오픈빌더 설정 → 기본 정보의 값과 같은지 확인해 주세요",
  card_block: "확인 카드 블록을 확인해 주세요",
  orderer_block: "주문자 정보 블록을 확인해 주세요",
  allergy_block: "알레르기 답 블록을 확인해 주세요",
  depositor_block: "입금자 이름 블록을 확인해 주세요",
  review_block: "후기 블록을 확인해 주세요",
};
export function KakaoChannelSettings(props: ShopLicenseProps) {
  const callbacks = useRef(props);
  callbacks.current = props;
  const [base, setBase] = useState<KakaoChannel | null>(null),
    [form, setForm] = useState<ChannelForm>(() => channelForm(null)),
    [loaded, setLoaded] = useState(false),
    [editing, setEditing] = useState(false),
    [latest, setLatest] = useState<KakaoChannel | null>(null),
    [stale, setStale] = useState(false),
    [showErrors, setShowErrors] = useState(false),
    [policy, setPolicy] = useState<"keep_24h" | "revoke_now">("keep_24h"),
    [secret, setSecret] = useState<{ connectionId: string; key: SkillKey } | null>(null);
  const [now, setNow] = useState(Date.now),
    [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  const expiredRead = useRef<string | null>(null),
    legacyDeadline = useRef<number | null>(null);
  const policyName = useId();
  const {
    loading,
    failure: loadFailure,
    read,
    retry,
    clearFailure,
    cancel: cancelRead,
  } = useVersionedRead(fetchKakaoChannel, {
    sessionChecking: Boolean(props.sessionChecking || props.logoutPending),
    sessionFailed: Boolean(props.sessionFailed),
    allowNotSet: true,
    onLoaded: (mode, data) => {
      if (mode === "stale") setLatest(data);
      else adopt(data, undefined, true);
    },
    onNotSet: () => adopt(null, undefined, true),
    onSessionExpired: () => callbacks.current.onSessionExpired(),
    onRegisterShop: () => callbacks.current.onRegisterShop(),
  });
  const command = useCommand<Action, Result>(async (input, key) => {
    if (callbacks.current.sessionChecking || callbacks.current.sessionFailed || callbacks.current.logoutPending)
      return CONNECTION_FAILED;
    const r =
      input.action === "save"
        ? await saveKakaoChannel(input.body, key)
        : input.action === "check"
          ? await startKakaoChannelCheck(key)
          : await rotateKakaoSkillKey(input.body, key);
    return r.ok ? { ...r, data: { ...r.data, action: input.action } } : r;
  });
  const handled = useRef<unknown>(null),
    handledFailure = useRef<unknown>(null),
    pendingFocus = useRef<string | null>(null),
    formRef = useRef<HTMLFormElement>(null),
    statusRef = useRef<HTMLElement>(null);
  const pending = (!loaded && loading) || command.busy || Boolean(props.sessionChecking || props.logoutPending),
    blocked = pending || Boolean(props.sessionFailed),
    locked = blocked || (!loaded && Boolean(loadFailure));
  const failure = command.state.kind === "failed" ? command.state.failure : null;
  const adopt = useCallback(
    (value: KakaoChannel | null, draft?: ChannelForm, reset = false) => {
      setBase(value);
      setForm(draft ?? channelForm(value));
      setLoaded(true);
      setEditing(value === null || Boolean(draft));
      setLatest(null);
      setStale(false);
      setShowErrors(false);
      clearFailure();
      setSecret((old) =>
        old && value && old.connectionId === value.connectionId && old.key.keyVersion === value.skill.keyVersion
          ? old
          : null,
      );
      if (reset) command.reset();
    },
    [clearFailure, command.reset],
  );
  useEffect(() => {
    if (command.state.kind !== "done" || handled.current === command.state.data) return;
    const result = command.state.data;
    handled.current = result;
    adopt(result.kakaoChannel);
    if (result.skillKey) setSecret({ connectionId: result.kakaoChannel.connectionId, key: result.skillKey });
  }, [command.state, adopt]);
  useEffect(() => {
    if (!failure || handledFailure.current === failure) return;
    handledFailure.current = failure;
    if (failure.outcome === "login") callbacks.current.onSessionExpired();
    if (failure.outcome === "no_shop") callbacks.current.onRegisterShop();
    if (failure.code === "not_set") adopt(null);
    if (failure.code === "version_conflict") {
      setStale(true);
      setLatest(null);
      read("stale");
    }
    if (failure.code === "channel_setup_incomplete") setEditing(true);
    if (failure.outcome === "field")
      pendingFocus.current = failure.fieldErrors.find((e) => fields.includes(e.field))?.field ?? "/botId";
  }, [failure, adopt, read]);
  useEffect(() => {
    if (!pendingFocus.current || blocked) return;
    const field = Array.from(formRef.current?.querySelectorAll<HTMLElement>("[data-pointer]") ?? []).find(
      (e) => e.dataset.pointer === pendingFocus.current,
    );
    const input = field?.querySelector<HTMLInputElement>("input");
    pendingFocus.current = null;
    (input && !input.disabled ? input : statusRef.current)?.focus();
  });
  const issues = useMemo(() => channelIssues(form), [form]);
  const errors = fieldErrorsFor(
    [...(failure?.fieldErrors ?? []), ...issues.filter((e) => showErrors || e.code !== "required")],
    fields,
  ).byField;
  function mutate(change: (old: ChannelForm) => ChannelForm) {
    if (locked || !editing) return;
    command.reset();
    setShowErrors(false);
    setForm(change);
  }
  function send(input: Action) {
    if (locked || command.blocked || (editing && input.action !== "save")) return;
    cancelRead();
    command.submit(input);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (locked || stale || !editing || command.blocked) return;
    if (issues.length) {
      setShowErrors(true);
      pendingFocus.current = issues[0]?.field ?? null;
      return;
    }
    send({ action: "save", body: channelPayload(base, form) });
  }
  const checking = base?.status === "pending" && base.checkStartedAt !== null && base.checkExpiresAt !== null;
  const legacyChecking = base?.status === "linked" && base.eventStatus === "checking";
  const remaining =
    checking && base?.checkExpiresAt ? Math.max(0, Math.ceil((Date.parse(base.checkExpiresAt) - now) / 1000)) : null;
  useEffect(() => {
    const update = () => {
      const show = document.visibilityState !== "hidden";
      setVisible(show);
      setNow(Date.now());
      if (!show && loaded && !stale) cancelRead();
    };
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [cancelRead, loaded, stale]);
  useEffect(() => {
    if (!checking || !visible) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [checking, visible]);
  useEffect(() => {
    if (!legacyChecking) legacyDeadline.current = null;
    if (!base || (!checking && !legacyChecking) || editing || stale || blocked || loading || loadFailure || !visible)
      return;
    if (legacyChecking && legacyDeadline.current === null) legacyDeadline.current = Date.now() + 600000;
    const deadline = checking && base.checkExpiresAt ? Date.parse(base.checkExpiresAt) : legacyDeadline.current;
    if (deadline === null) return;
    const key = `${base.connectionId}:${deadline}`;
    if (Date.now() >= deadline && expiredRead.current === key) return;
    const timer = setTimeout(
      () => {
        if (Date.now() >= deadline) expiredRead.current = key;
        read();
      },
      Math.min(5000, Math.max(0, deadline - Date.now())),
    );
    return () => clearTimeout(timer);
  }, [base, checking, legacyChecking, editing, stale, blocked, loading, loadFailure, visible, read]);
  function done(result: Result) {
    if (result.action === "rotate") return "스킬 키를 바꿨어요. 새 키를 오픈빌더 헤더 값에 넣고 배포해 주세요";
    if (result.outcome === "unchanged") return "바뀐 것이 없어요";
    if (result.action === "check") return "연결 확인을 시작했어요";
    return result.outcome === "created"
      ? "저장했어요. 아래 스킬 설정 값을 오픈빌더에 넣어 주세요"
      : "블록 ID를 바꿨어요. 연결 확인을 다시 해 주세요";
  }
  return (
    <OwnerLayout
      screen="SCR-041"
      title="카카오톡 채널 연결"
      shopName={props.shopName}
      back="/owner/shop"
      busy={blocked}
      onNavigate={(href, e) => {
        e.preventDefault();
        if (!blocked) props.onNavigate(href);
      }}
    >
      <div className="channel-editor">
        <div className="channel-actions">
          <Button
            disabled={pending}
            busy={Boolean(props.logoutPending)}
            onClick={() => {
              if (!pending) props.onLogout();
            }}
          >
            로그아웃
          </Button>
        </div>
        {props.logoutFailure ? <Banner tone="danger">{props.logoutFailure.message}</Banner> : null}
        {loading && !loaded ? <Skeleton label="채널을 불러오고 있어요" rows={7} /> : null}
        {loadFailure ? (
          <LoadFailure
            failure={classify(loadFailure.status, loadFailure.problem, loadFailure.retryAfterSeconds)}
            disabled={blocked || loading}
            onRetry={() => {
              if (!blocked && !loading) retry();
            }}
            onLogin={props.onSessionExpired}
            onRegisterShop={props.onRegisterShop}
          />
        ) : null}
        {loaded ? (
          <form ref={formRef} noValidate onSubmit={submit} className="channel-form">
            {!base ? (
              <>
                <Banner tone="accent">아직 정하지 않았어요</Banner>
                <ol>
                  <li>오픈빌더에서 봇과 버튼 블록 다섯을 열어 주세요.</li>
                  <li>봇 ID·채널 공개 ID·블록 ID를 넣고 저장해 주세요.</li>
                  <li>스킬 설정 값을 옮기고 안내 블록의 이벤트 이름을 붙여 배포해 주세요.</li>
                  <li>연결 확인의 문구를 보내고 시험 버튼 다섯을 눌러 주세요.</li>
                  <li>연결되면 손님 안내는 다음 대화 때 전해요.</li>
                </ol>
              </>
            ) : (
              <section className="channel-status" aria-label="채널 연결 상태">
                <h2>
                  {base.status === "linked" ? "연결됨" : base.status === "failed" ? "연결 안 됨" : "연결 확인 중"}
                </h2>
                {base.status === "linked" ? <p>손님 안내는 다음 대화 때 전해요</p> : null}
                {base.linkedAt ? <p>연결된 시각 {formatKoreanDateTime(base.linkedAt)}</p> : null}
                {base.proofPhrase && base.status === "pending" ? (
                  <>
                    <CopyValue label="연결 문구" value={base.proofPhrase} disabled={blocked} />
                    <p>이 문구를 가게 채널 대화창에 그대로 보내고 답으로 오는 시험 버튼 5개를 차례로 눌러 주세요</p>
                  </>
                ) : null}
                <p>닿은 블록 {base.verifiedBlocks.length}/5</p>
                {remaining !== null ? (
                  <p>
                    남은 시간 {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
                  </p>
                ) : null}
                <ul aria-label="블록 확인 상태">
                  {BLOCK_KEYS.map((key) => (
                    <li key={key}>
                      {BLOCK_LABELS[key]}: {base.verifiedBlocks.includes(verifiedNames[key]) ? "닿음" : "기다림"}
                    </li>
                  ))}
                </ul>
                {base.failureHints.length ? (
                  <ul>
                    {base.failureHints.map((hint) => (
                      <li key={hint}>{hints[hint]}</li>
                    ))}
                  </ul>
                ) : null}
                {base.eventStatus === "checking" ? (
                  <p>먼저 보내기 확인 중</p>
                ) : base.eventStatus === "ready" ? (
                  <p>먼저 보내기 됨</p>
                ) : base.eventStatus === "unavailable" ? (
                  <>
                    <p>
                      먼저 보내기 안 됨:{" "}
                      {base.eventFailReason ? eventReasons[base.eventFailReason] : "연결 상태를 다시 확인해 주세요"}
                    </p>
                    <p>그동안 손님 안내는 손님이 다음에 말을 걸 때 먼저 전해요</p>
                  </>
                ) : null}
                <div className="channel-actions">
                  <Button
                    disabled={locked}
                    onClick={() => {
                      if (!locked) {
                        cancelRead();
                        command.reset();
                        clearFailure();
                        setEditing(true);
                      }
                    }}
                  >
                    채널 바꾸기
                  </Button>
                  <Button
                    disabled={blocked || editing || loading}
                    busy={loading}
                    onClick={() => {
                      if (!blocked && !editing && !loading) read();
                    }}
                  >
                    연결 상태 다시 보기
                  </Button>
                </div>
              </section>
            )}
            <section ref={statusRef} tabIndex={-1} aria-label="채널 설정 결과">
              <CommandStatus
                state={command.state}
                fields={fields}
                disabled={locked}
                done={done}
                onRetry={() => {
                  if (!locked && !stale) command.retry();
                }}
                onReload={() => {
                  if (!locked) {
                    setStale(true);
                    read("stale");
                  }
                }}
              />
              {showErrors && issues.length ? <Banner tone="danger">입력한 내용을 확인해 주세요</Banner> : null}
            </section>
            {stale ? (
              <section className="channel-latest" aria-label="지금 채널">
                <Banner tone="warning">그 사이 바뀌었어요. 지금 상태를 확인해 주세요</Banner>
                {latest ? (
                  <>
                    <p>지금 봇 ID: {latest.botId}</p>
                    <Button
                      disabled={locked}
                      onClick={() => {
                        if (!locked) adopt(latest, rebaseChannel(base, form, latest), true);
                      }}
                    >
                      내 변경 다시 적용
                    </Button>
                    <Button
                      disabled={locked}
                      onClick={() => {
                        if (!locked) adopt(latest, undefined, true);
                      }}
                    >
                      지금 값으로 다시 시작
                    </Button>
                  </>
                ) : null}
              </section>
            ) : null}
            <TextField
              pointer="/botId"
              label="봇 ID"
              value={form.botId}
              disabled={locked || !editing}
              errors={errors.get("/botId")}
              help="빈칸 없이 64자까지"
              onChange={(e) => {
                const value = e.currentTarget.value;
                mutate((old) => ({ ...old, botId: value }));
              }}
            />
            <TextField
              pointer="/channelPublicId"
              label="채널 공개 ID(선택)"
              value={form.channelPublicId}
              disabled={locked || !editing}
              errors={errors.get("/channelPublicId")}
              help="밑줄(_)로 시작하는 공개 ID"
              onChange={(e) => {
                const value = e.currentTarget.value;
                mutate((old) => ({ ...old, channelPublicId: value }));
              }}
            />
            <fieldset className="channel-blocks">
              <legend>버튼 블록 ID 다섯</legend>
              {BLOCK_KEYS.map((key) => (
                <TextField
                  key={key}
                  pointer={`/blockIds/${key}`}
                  label={BLOCK_LABELS[key]}
                  value={form.blockIds[key]}
                  disabled={locked || !editing}
                  errors={errors.get(`/blockIds/${key}`)}
                  note={
                    base?.status === "failed" && base.failureHints.includes(missingHints[key])
                      ? "시험 버튼이 닿지 않았어요. 블록 ID와 배포를 확인해 주세요"
                      : undefined
                  }
                  help="빈칸 없이 100자까지"
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    mutate((old) => ({ ...old, blockIds: { ...old.blockIds, [key]: value } }));
                  }}
                />
              ))}
            </fieldset>
            <details open={!base}>
              <summary>봇 ID·블록 ID 찾는 법</summary>
              <p>
                오픈빌더에서 봇을 열었을 때 주소의 /bot/ 다음 값이 봇 ID예요. 버튼이 실행할 블록을 열고 블록 ID를 복사해
                주세요.
              </p>
            </details>
            {editing ? (
              <div className="channel-actions">
                <Button kind="primary" type="submit" disabled={locked || stale || command.blocked} busy={command.busy}>
                  저장
                </Button>
              </div>
            ) : null}
            {base ? (
              <>
                <details open={Boolean(secret)}>
                  <summary>스킬 설정 값</summary>
                  {skillUrls.map(([key, label]) => (
                    <CopyValue key={key} label={label} value={base.skill[key]} disabled={blocked} />
                  ))}
                  <CopyValue label="안내 이벤트 이름" value={base.skill.eventName} disabled={blocked} />
                  <CopyValue label="스킬 헤더 이름" value={base.skill.headerName} disabled={blocked} />
                  <p>
                    스킬 키 버전 {base.skill.keyVersion} · 만든 시각 {formatKoreanDateTime(base.skill.keyIssuedAt)}
                  </p>
                  {secret ? (
                    <>
                      <CopyValue label="스킬 키(지금만 보임)" value={secret.key.headerValue} disabled={blocked} />
                      <p>이 키는 지금만 보여요. 잃으면 스킬 키를 바꿔요</p>
                    </>
                  ) : null}
                  {base.skill.previousKeyValidUntil ? (
                    <p>옛 키는 {formatKoreanDateTime(base.skill.previousKeyValidUntil)}까지 받아요</p>
                  ) : command.state.kind === "done" && command.state.data.action === "rotate" ? (
                    <p>옛 키는 바로 끊었어요. 배포할 때까지 손님 메시지를 받지 않아요</p>
                  ) : null}
                  <fieldset disabled={locked}>
                    <legend>옛 키</legend>
                    {(
                      [
                        ["keep_24h", "24시간 더 받기"],
                        ["revoke_now", "바로 끊기"],
                      ] as const
                    ).map(([value, label]) => (
                      <label className="channel-choice" key={value}>
                        <input
                          type="radio"
                          name={policyName}
                          value={value}
                          checked={policy === value}
                          onChange={() => {
                            if (!locked) setPolicy(value);
                          }}
                        />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                  <Button
                    disabled={locked || command.blocked}
                    onClick={() => {
                      if (!locked)
                        send({
                          action: "rotate",
                          body: { baseRevision: base.revision, previousKey: policy },
                        });
                    }}
                  >
                    스킬 키 바꾸기
                  </Button>
                </details>
                {base.status !== "linked" ? (
                  <Button
                    disabled={locked || command.blocked || editing}
                    onClick={() => {
                      if (!locked && !editing) send({ action: "check" });
                    }}
                  >
                    {base.status === "failed" ? "다시 확인" : "연결 확인"}
                  </Button>
                ) : null}
              </>
            ) : null}
          </form>
        ) : null}
      </div>
    </OwnerLayout>
  );
}
