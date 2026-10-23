"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Mail,
  LayoutDashboard,
  Send,
  Users,
  PanelsTopLeft,
  Plug,
  Settings,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Search,
  Check,
  Clock,
  FileText,
  ShieldCheck,
  Download,
  X,
  Copy,
  Trash2,
  Loader2,
  Inbox,
  Monitor,
  Smartphone,
  BookOpen,
  ChevronDown,
  Globe,
  Pencil,
} from "lucide-react";
import { renderEmail } from "../core/domain.ts";
import {
  t,
  useLocale,
  formatDate,
  formatNumber,
  currentLocale,
  applyDocumentLang,
  LOCALES,
  localeInfo,
  type LocaleCode,
} from "./i18n.ts";
import "./styles.css";
type Item = Record<string, any>;
type Page =
  | "overview"
  | "campaigns"
  | "contacts"
  | "templates"
  | "integrations"
  | "settings";
const navigation: { id: Page; label: string; icon: typeof Mail }[] = [
  { id: "overview", label: "Tổng quan", icon: LayoutDashboard },
  { id: "campaigns", label: "Chiến dịch", icon: Send },
  { id: "contacts", label: "Danh bạ", icon: Users },
  { id: "templates", label: "Mẫu email", icon: PanelsTopLeft },
  { id: "integrations", label: "Tích hợp", icon: Plug },
  { id: "settings", label: "Cài đặt", icon: Settings },
];
const labels: Record<string, string> = {
  draft: "Bản nháp",
  queued: "Đang chờ gửi",
  completed: "Đã xử lý",
  cancelled: "Đã hủy",
  active: "Đang hoạt động",
  unsubscribed: "Đã hủy nhận",
  suppressed: "Đã chặn",
  pending: "Chờ xác nhận",
  accepted: "SMTP đã nhận",
  unknown: "Cần đối soát",
  skipped: "Bỏ qua",
  submitting: "Đang xử lý",
  admin: "Quản trị viên",
  editor: "Biên tập viên",
  viewer: "Chỉ xem",
};
const label = (value: string) => t(labels[value] || value);
const deliveryLabels: Record<string, string> = {
  pending: "Chờ gửi",
  submitting: "Đang xử lý",
  accepted: "SMTP đã nhận",
  unknown: "Cần đối soát",
  skipped: "Bỏ qua",
};
const deliveryLabel = (value: string) =>
  t(deliveryLabels[value] || labels[value] || value);
const dnsLabel = (id: string) =>
  t({ mx: "Bản ghi MX", spf: "SPF", dkim: "DKIM", dmarc: "DMARC" }[id] || id);
const dnsReason = (reason: string) =>
  t(
    {
      missing: "Chưa có bản ghi",
      multiple: "Có nhiều bản ghi SPF",
      "no-all": "Thiếu -all hoặc ~all",
      "empty-key": "Khoá công khai rỗng",
      "policy-none": "Chính sách p=none",
      policy: "Chính sách chưa đủ mạnh",
    }[reason] || reason,
  );
type Starter = {
  name: string;
  type: string;
  subject: string;
  body: string;
  art: string;
  accent: string;
  category: "marketing" | "internal";
};
const starterVi: Starter[] = [
  {
    name: "Một lời chào đầu tiên",
    type: "Chào mừng",
    subject: "Chào mừng {{first_name}} đến với chúng tôi",
    body: "Chào {{first_name}},\n\nCảm ơn bạn đã đăng ký nhận thông tin. Từ hôm nay, chúng tôi sẽ gửi đến bạn những cập nhật hữu ích và nội dung được chọn lọc.\n\nBạn có thể trả lời email này để chia sẻ điều mình quan tâm. Chúng tôi luôn sẵn lòng lắng nghe.\n\nHẹn gặp bạn trong bản tin tiếp theo!",
    art: "Một lời chào,\nnhiều kết nối.",
    accent: "#e5eee5",
    category: "marketing",
  },
  {
    name: "Chuyện mới trong tháng",
    type: "Bản tin",
    subject: "Bản tin tháng này dành cho {{first_name}}",
    body: "Chào {{first_name}},\n\nTháng này, chúng tôi có một vài điều muốn chia sẻ cùng bạn.\n\nĐIỂM TIN NỔI BẬT\nViết cập nhật quan trọng nhất tại đây: điều gì đã thay đổi và vì sao điều đó hữu ích với người nhận.\n\nDÀNH RIÊNG CHO BẠN\nBổ sung một lời khuyên hoặc tài nguyên mà bạn muốn giới thiệu.\n\nCảm ơn bạn đã đồng hành.",
    art: "Có điều hay,\nkể bạn nghe.",
    accent: "#f1eadc",
    category: "marketing",
  },
  {
    name: "Cùng nhau bắt đầu",
    type: "Nếp HR · nội bộ",
    subject: "Chào {{first_name}}, cùng bắt đầu tuần mới",
    body: "Chào {{first_name}},\n\nĐây là những thông tin nội bộ bạn cần cho tuần mới.\n\nLỊCH HOẠT ĐỘNG\nBổ sung thời gian, địa điểm và đầu mối hỗ trợ.\n\nNỘI DUNG ĐÀO TẠO\nGiới thiệu chương trình, đối tượng tham gia và cách đăng ký.\n\nChúc bạn một tuần làm việc hiệu quả!",
    art: "Một đội ngũ.\nCùng nhịp bước.",
    accent: "#e4ebf0",
    category: "internal",
  },
  {
    name: "Giữ kết nối với khách hàng",
    type: "Nếp Business",
    subject: "{{first_name}} ơi, chúng tôi có cập nhật mới",
    body: "Chào {{first_name}},\n\nCảm ơn bạn đã quan tâm đến sản phẩm của chúng tôi.\n\nLẦN NÀY CÓ GÌ MỚI?\nMô tả lợi ích cụ thể và các điều kiện áp dụng trước khi gửi.\n\nBạn muốn tìm hiểu thêm? Hãy trả lời email này để được hỗ trợ.\n\nTrân trọng.",
    art: "Mỗi lần gặp,\nthêm gắn kết.",
    accent: "#efe4df",
    category: "marketing",
  },
];
const starterEn: Starter[] = [
  {
    name: "A first hello",
    type: "Welcome",
    subject: "Welcome aboard, {{first_name}}",
    body: "Hi {{first_name}},\n\nThank you for subscribing. From today we will send you useful updates and hand-picked stories.\n\nReply to this email to tell us what you care about. We read every answer.\n\nSee you in the next issue!",
    art: "One hello,\nmany connections.",
    accent: "#e5eee5",
    category: "marketing",
  },
  {
    name: "What is new this month",
    type: "Newsletter",
    subject: "This month, for {{first_name}}",
    body: "Hi {{first_name}},\n\nA few things we wanted to share with you this month.\n\nHIGHLIGHTS\nWrite the single most important update here: what changed and why it matters to the reader.\n\nJUST FOR YOU\nAdd one tip or resource you want to recommend.\n\nThanks for being here.",
    art: "Something good,\nworth telling.",
    accent: "#f1eadc",
    category: "marketing",
  },
  {
    name: "Let us start together",
    type: "Internal",
    subject: "Hi {{first_name}}, let us start the week",
    body: "Hi {{first_name}},\n\nHere is what you need for the week ahead.\n\nSCHEDULE\nAdd time, location and the person to ask for help.\n\nTRAINING\nDescribe the programme, who it is for and how to sign up.\n\nHave a productive week!",
    art: "One team.\nOne rhythm.",
    accent: "#e4ebf0",
    category: "internal",
  },
  {
    name: "Stay close to your customers",
    type: "Customer",
    subject: "{{first_name}}, we have an update",
    body: "Hi {{first_name}},\n\nThank you for your interest in what we build.\n\nWHAT IS NEW?\nDescribe the concrete benefit and the conditions before you send.\n\nWant to know more? Reply to this email and we will help.\n\nKind regards.",
    art: "Every meeting,\na closer bond.",
    accent: "#efe4df",
    category: "marketing",
  },
];
const starterTemplates = (locale: LocaleCode): Starter[] =>
  locale === "vi" ? starterVi : starterEn;
const blank = {
  name: "",
  subject: "",
  preheader: "",
  body: "",
  category: "marketing",
  audienceTag: "",
  locale: "vi",
};
const date = (s: string) => formatDate(s);
const num = (v: number) => formatNumber(v);
async function request(path: string, method = "GET", data?: unknown) {
  const r = await fetch("/api/" + path, {
    method,
    headers: {
      "accept-language": localeInfo(currentLocale()).tag,
      ...(data ? { "content-type": "application/json" } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const p = (await r.json()) as Item;
  if (!r.ok) throw new Error(p.error || t("Không thể hoàn tất yêu cầu"));
  return p;
}
function Badge({ value }: { value: string }) {
  return (
    <span className={"badge " + value}>
      <span />
      {label(value)}
    </span>
  );
}
function Empty({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: typeof Mail;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <Icon size={30} strokeWidth={1.3} />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "dialog wide" : "dialog"}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-label={title}
    >
      <header>
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label={t("Đóng")}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
function download(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const defaultAuthRoutes = { signIn: "/auth/login", signOut: "/auth/logout" };
export default function App({
  auth = defaultAuthRoutes,
}: {
  auth?: typeof defaultAuthRoutes;
}) {
  const [page, setPage] = useState<Page>("overview"),
    [boot, setBoot] = useState<Item | null>(null),
    [data, setData] = useState<Item | null>(null),
    [workspace, setWorkspace] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [modal, setModal] = useState<
      "workspace" | "contact" | "key" | "form" | null
    >(null),
    [editor, setEditor] = useState<Item | null>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [confirm, setConfirm] = useState<{
      text: string;
      run: () => Promise<void>;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [token, setToken] = useState(""),
    [dnsDomain, setDnsDomain] = useState(""),
    [dns, setDns] = useState<Item | null>(null),
    [dnsBusy, setDnsBusy] = useState(false),
    [renaming, setRenaming] = useState(false),
    [nameDraft, setNameDraft] = useState(""),
    [dkim, setDkim] = useState<Item | null>(null),
    [locale, changeLocale] = useLocale();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function notice(s: string) {
    setToast(s);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 6500);
  }
  const loadBoot = useCallback(async () => {
    const b = await request("bootstrap");
    setBoot(b);
    setWorkspace((w) =>
      b.workspaces.some((v: Item) => v.id === w)
        ? w
        : b.workspaces[0]?.id || "",
    );
    return b;
  }, []);
  async function saveWorkspaceName() {
    const name = nameDraft.trim();
    if (!workspace) return;
    if (name.length < 2) {
      notice(t("Tên workspace quá ngắn"));
      return;
    }
    setBusy(true);
    try {
      // The name is printed in the footer of every email, so reload both the
      // workspace list and the open workspace after saving.
      await request("workspaces/" + workspace, "PATCH", { name });
      await loadBoot();
      setData(await request("workspaces/" + workspace));
      setRenaming(false);
      notice(t("Đã đổi tên workspace"));
    } catch (e) {
      notice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const refresh = useCallback(async () => {
    if (workspace) {
      const p = await request("workspaces/" + workspace);
      setData(p);
    }
  }, [workspace]);
  useEffect(() => {
    applyDocumentLang();
  }, [locale]);
  useEffect(() => {
    loadBoot()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [loadBoot]);
  useEffect(() => {
    if (!workspace) {
      setData(null);
      return;
    }
    setLoading(true);
    setData(null);
    setError("");
    let active = true;
    request("workspaces/" + workspace)
      .then((p) => {
        if (active) setData(p);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workspace]);
  useEffect(() => {
    setSearch("");
    setFilter("all");
  }, [page]);
  const role =
    boot?.workspaces.find((w: Item) => w.id === workspace)?.role || "viewer";
  const write = role !== "viewer",
    admin = role === "admin";
  const path = (resource: string) => `workspaces/${workspace}/${resource}`;
  async function mutate(resource: string, method: string, p?: unknown) {
    const r = await request(path(resource), method, p);
    await refresh();
    return r;
  }
  async function task(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function go(p: Page) {
    setPage(p);
    setEditor(null);
  }
  function newCampaign(tpl?: Starter) {
    setEditor(
      tpl
        ? {
            ...blank,
            name: tpl.name,
            subject: tpl.subject,
            body: tpl.body,
            category: tpl.category,
            locale: tpl.type.startsWith("Nếp") || locale === "vi" ? "vi" : "en",
          }
        : { ...blank, locale: locale === "vi" ? "vi" : locale },
    );
  }
  const templates = starterTemplates(locale),
    contacts: Item[] = data?.contacts || [],
    campaigns: Item[] = data?.campaigns || [],
    delivery = boot?.delivery;
  const consented = contacts.filter(
    (p) => p.status === "active" && p.consent === 1,
  ).length;
  const waiting = campaigns.filter((c) => c.status === "queued").length;
  const counts = (status: string) =>
    (data?.deliveryCounts || []).find((r: Item) => r.status === status)?.n || 0;
  const filteredCampaigns = campaigns.filter(
    (c) =>
      (filter === "all" || c.status === filter) &&
      `${c.name} ${c.subject}`.toLowerCase().includes(search.toLowerCase()),
  );
  const filteredContacts = contacts.filter(
    (c) =>
      (filter === "all" || c.status === filter) &&
      `${c.name} ${c.email} ${c.tags}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const title = t(navigation.find((n) => n.id === page)!.label);
  const topAction =
    write && workspace ? (
      <button
        className="button primary"
        onClick={() =>
          page === "contacts" ? setModal("contact") : newCampaign()
        }
      >
        <Plus size={17} />
        {page === "contacts" ? t("Thêm liên hệ") : t("Tạo chiến dịch")}
      </button>
    ) : null;
  return (
    <div className="app-shell">
      <a className="skip" href="#main">
        {t("Đến nội dung chính")}
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("overview");
          }}
          aria-label={t("Nếp Mail · Tổng quan")}
        >
          <span className="brand-icon">
            <Mail size={23} strokeWidth={1.7} />
          </span>
          <span>
            {t("nếp")}
            <span className="brand-mail">mail</span>
            <small>{t("Gửi điều có ý nghĩa.")}</small>
          </span>
        </a>
        <div className="workspace-box">
          <small>{t("KHÔNG GIAN LÀM VIỆC")}</small>
          <div className="workspace-select">
            <span className="workspace-avatar">
              {data?.workspace?.name?.[0] || "N"}
            </span>
            {renaming ? (
              <form
                className="workspace-rename"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveWorkspaceName();
                }}
              >
                <input
                  aria-label={t("Tên workspace")}
                  autoFocus
                  maxLength={100}
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setRenaming(false);
                  }}
                />
                <button
                  className="text-button"
                  type="submit"
                  disabled={busy || nameDraft.trim().length < 2}
                >
                  {t("Lưu")}
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setRenaming(false)}
                >
                  {t("Hủy")}
                </button>
              </form>
            ) : (
              <>
                <select
                  aria-label={t("Chọn workspace")}
                  disabled={busy || loading}
                  value={workspace}
                  onChange={(e) => setWorkspace(e.target.value)}
                >
                  <option value="" disabled>
                    {t("Chọn workspace")}
                  </option>
                  {boot?.workspaces.map((w: Item) => (
                    <option value={w.id} key={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} />
                {role === "admin" && workspace ? (
                  <button
                    className="icon-button workspace-rename-open"
                    type="button"
                    aria-label={t("Đổi tên workspace")}
                    title={t("Đổi tên workspace")}
                    onClick={() => {
                      setNameDraft(data?.workspace?.name || "");
                      setRenaming(true);
                    }}
                  >
                    <Pencil size={13} />
                  </button>
                ) : null}
              </>
            )}
          </div>
          <button
            className="text-button workspace-add"
            onClick={() => setModal("workspace")}
          >
            <Plus size={13} />
            {t("Tạo workspace")}
          </button>
        </div>
        <nav aria-label={t("Điều hướng chính")}>
          {navigation.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "nav-item selected" : "nav-item"}
              aria-current={page === n.id ? "page" : undefined}
              onClick={() => go(n.id)}
            >
              <n.icon size={19} strokeWidth={1.7} />
              {t(n.label)}
              {n.id === "campaigns" && waiting > 0 && (
                <span className="nav-count">{waiting}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="edition">
            <span className="edition-dot" />
            SELF-HOSTED · ALPHA 0.4
          </div>
          <p style={{ whiteSpace: "pre-line" }}>
            {t("Dữ liệu của bạn.\nHạ tầng do bạn làm chủ.")}
          </p>
          <button
            className="help-link"
            onClick={() => {
              go("settings");
              document.getElementById("release")?.scrollIntoView();
            }}
          >
            <BookOpen size={16} />
            {t("Hướng dẫn & trạng thái")}
          </button>
        </div>
        <div className="profile">
          <span className="avatar">{boot?.user?.name?.[0] || "N"}</span>
          <div>
            <strong>{boot?.user?.name || t("Nếp Mail")}</strong>
            <small>{label(role)}</small>
          </div>
          <a
            href={auth.signOut}
            aria-label={t("Đăng xuất")}
            title={t("Đăng xuất")}
          >
            <ArrowUpRight size={17} />
          </a>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span>
            <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            <button
              className="icon-button mobile-workspace-add"
              aria-label={t("Tạo workspace mới")}
              onClick={() => setModal("workspace")}
            >
              <Plus size={16} />
            </button>
            <label className="language-select">
              <Globe size={15} aria-hidden="true" />
              <select
                aria-label={t("Ngôn ngữ giao diện")}
                value={locale}
                onChange={(e) => changeLocale(e.target.value as LocaleCode)}
              >
                {LOCALES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.native}
                  </option>
                ))}
              </select>
            </label>
            <span className="alpha-note">{t("Bản thử nghiệm riêng tư")}</span>
            <span className="top-avatar">N</span>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                NẾP MAIL /{" "}
                {page === "overview"
                  ? t("KHỞI ĐẦU MỖI KẾT NỐI")
                  : title.toLocaleUpperCase()}
              </div>
              <h1>
                {page === "overview"
                  ? t("Những kết nối, được chăm chút.")
                  : title}
              </h1>
              <p>
                {
                  {
                    overview: t(
                      "Một nơi để giữ liên lạc, kể câu chuyện và nuôi dưỡng mối quan hệ.",
                    ),
                    campaigns: t(
                      "Từ ý tưởng đầu tiên đến từng email được gửi đi.",
                    ),
                    contacts: t(
                      "Hiểu người nhận. Gửi đúng người, đúng sự đồng ý.",
                    ),
                    templates: t(
                      "Bắt đầu với một mẫu gọn gàng, rồi kể câu chuyện của bạn.",
                    ),
                    integrations: t(
                      "Kết nối hệ sinh thái Nếp, giữ quyền kiểm soát dữ liệu.",
                    ),
                    settings: t(
                      "Quản lý workspace, quyền truy cập và hạ tầng gửi.",
                    ),
                  }[page]
                }
              </p>
            </div>
            {topAction}
          </div>
          {error && (
            <div className="alert error" role="alert">
              <strong>{error}</strong>
              <button
                className="text-button"
                onClick={() =>
                  task(async () => {
                    setError("");
                    await loadBoot();
                    await refresh();
                  })
                }
              >
                {t("Thử lại")}
              </button>
              {!boot && (
                <a href={auth.signIn} target="_top">
                  {t("Đăng nhập")}
                </a>
              )}
            </div>
          )}
          {loading ? (
            <div className="loading" role="status">
              <Loader2 className="spin" />
              {t("Đang tải workspace…")}
            </div>
          ) : !workspace ? (
            <section className="welcome">
              <div className="welcome-symbol">
                <Mail size={46} strokeWidth={1.2} />
              </div>
              <span className="eyebrow">{t("BẠN ĐÃ SẴN SÀNG")}</span>
              <h2 style={{ whiteSpace: "pre-line" }}>
                {t("Mỗi kết nối tốt đẹp\nbắt đầu bằng một lời chào.")}
              </h2>
              <p>
                {t(
                  "Tạo workspace đầu tiên để quản lý danh bạ, soạn bản tin và chuẩn bị chiến dịch email của bạn.",
                )}
              </p>
              <button
                className="button primary"
                onClick={() => setModal("workspace")}
              >
                <Plus size={17} />
                {t("Tạo workspace đầu tiên")}
              </button>
              <div className="welcome-facts">
                <span>
                  <ShieldCheck size={16} />
                  {t("Tách biệt dữ liệu")}
                </span>
                <span>
                  <Mail size={16} />
                  {t("SMTP tự vận hành")}
                </span>
                <span>
                  <Check size={16} />
                  {t("Không cần API key gửi mail")}
                </span>
              </div>
            </section>
          ) : (
            data && (
              <>
                {page === "overview" && (
                  <>
                    <section className="status-banner">
                      <div className="banner-mark">
                        <Mail size={25} strokeWidth={1.4} />
                      </div>
                      <div>
                        <span className="eyebrow">
                          {t("MỘT KHỞI ĐẦU CHỈN CHU")}
                        </span>
                        <h2>
                          {delivery?.ready
                            ? t("Máy chủ gửi đã sẵn sàng.")
                            : t("Chuẩn bị chiến dịch đầu tiên của bạn.")}
                        </h2>
                        <p>
                          {delivery?.ready
                            ? t(
                                "Kiểm tra nội dung và người nhận trước mỗi lần gửi.",
                              )
                            : t(
                                "Danh bạ, nội dung và hàng đợi đã có chỗ. Gửi Internet đang tắt.",
                              )}
                        </p>
                      </div>
                      <button
                        className="button banner-button"
                        onClick={() => go("settings")}
                      >
                        {t("Kiểm tra thiết lập")}
                        <ArrowRight size={16} />
                      </button>
                    </section>
                    <section
                      className="metrics"
                      aria-label={t("Số liệu workspace")}
                    >
                      <div>
                        <span>
                          {t("Tổng liên hệ")}
                          <Users size={16} />
                        </span>
                        <strong>{num(contacts.length)}</strong>
                        <small>{t("Trong workspace hiện tại")}</small>
                      </div>
                      <div>
                        <span>
                          {t("Đồng ý nhận marketing")}
                          <ShieldCheck size={16} />
                        </span>
                        <strong>{num(consented)}</strong>
                        <small>{t("Đang hoạt động và có nguồn đồng ý")}</small>
                      </div>
                      <div>
                        <span>
                          {t("Chiến dịch chờ gửi")}
                          <Clock size={16} />
                        </span>
                        <strong>{num(waiting)}</strong>
                        <small>{t("Đã chốt danh sách người nhận")}</small>
                      </div>
                      <div>
                        <span>
                          {t("SMTP đã tiếp nhận")}
                          <Send size={16} />
                        </span>
                        <strong>{num(counts("accepted"))}</strong>
                        <small>{t("Chưa xác nhận đến inbox")}</small>
                      </div>
                    </section>
                    <div className="overview-grid">
                      <section className="surface">
                        <div className="section-heading">
                          <h2>{t("Chiến dịch gần đây")}</h2>
                          <button
                            className="text-button"
                            onClick={() => go("campaigns")}
                          >
                            {t("Xem tất cả")}
                            <ArrowRight size={14} />
                          </button>
                        </div>
                        {campaigns.length ? (
                          <CampaignTable
                            rows={campaigns.slice(0, 5)}
                            onOpen={setEditor}
                          />
                        ) : (
                          <Empty
                            title={t("Một câu chuyện đang chờ được kể")}
                            description={t(
                              "Tạo chiến dịch đầu tiên hoặc chọn một mẫu email để bắt đầu.",
                            )}
                            action={
                              <button
                                className="button"
                                onClick={() => go("templates")}
                              >
                                {t("Khám phá mẫu email")}
                                <ArrowRight size={15} />
                              </button>
                            }
                          />
                        )}
                      </section>
                      <section className="getting-started">
                        <div className="section-heading">
                          <h2>{t("Sẵn sàng để gửi")}</h2>
                          <span className="small-muted">
                            {
                              [
                                contacts.length > 0,
                                campaigns.length > 0,
                                delivery?.ready,
                              ].filter(Boolean).length
                            }
                            {t("/3 bước")}
                          </span>
                        </div>
                        {[
                          {
                            done: contacts.length > 0,
                            n: "01",
                            title: t("Xây danh bạ của bạn"),
                            text: t("Thêm liên hệ và ghi nhận nguồn đồng ý."),
                            page: "contacts",
                          },
                          {
                            done: campaigns.length > 0,
                            n: "02",
                            title: t("Soạn điều muốn chia sẻ"),
                            text: t("Chọn mẫu, viết nội dung, xem trước."),
                            page: "templates",
                          },
                          {
                            done: delivery?.ready,
                            n: "03",
                            title: t("Kết nối máy chủ SMTP"),
                            text: t("Cấu hình self-host và xác thực tên miền."),
                            page: "settings",
                          },
                        ].map((s) => (
                          <button
                            className="step"
                            key={s.n}
                            onClick={() => go(s.page as Page)}
                          >
                            <span
                              className={
                                s.done ? "step-number done" : "step-number"
                              }
                            >
                              {s.done ? <Check size={16} /> : s.n}
                            </span>
                            <span>
                              <strong>{s.title}</strong>
                              <small>{s.text}</small>
                            </span>
                            <ArrowUpRight size={16} />
                          </button>
                        ))}
                        {contacts.length === 0 && admin && (
                          <button
                            className="text-button demo-button"
                            disabled={busy}
                            onClick={() =>
                              task(async () => {
                                await mutate("demo", "POST", {});
                                notice(
                                  t(
                                    "Đã tạo 6 liên hệ tổng hợp. Không gửi ra Internet.",
                                  ),
                                );
                              })
                            }
                          >
                            {t("Thử với dữ liệu mẫu")}
                            <ArrowRight size={14} />
                          </button>
                        )}
                      </section>
                    </div>
                    <section className="template-strip">
                      <div>
                        <span className="eyebrow">
                          {t("BẮT ĐẦU NHANH HƠN")}
                        </span>
                        <h2 style={{ whiteSpace: "pre-line" }}>
                          {t(
                            "Một khung thư đẹp.\nMột câu chuyện của riêng bạn.",
                          )}
                        </h2>
                        <button
                          className="text-button"
                          onClick={() => go("templates")}
                        >
                          {t("Xem thư viện mẫu")}
                          <ArrowRight size={15} />
                        </button>
                      </div>
                      {templates.slice(0, 3).map((tpl) => (
                        <button
                          className="mini-template"
                          key={tpl.name}
                          onClick={() => write && newCampaign(tpl)}
                          disabled={!write}
                        >
                          <div style={{ background: tpl.accent }}>
                            <span className="paper-preview">
                              <span className="paper-logo">nếp.</span>
                              <span className="paper-line long" />
                              <span
                                className="paper-title"
                                style={{ whiteSpace: "pre-line" }}
                              >
                                {tpl.art}
                              </span>
                              <span className="paper-line" />
                              <span className="paper-line long" />
                              <span className="paper-cta" />
                            </span>
                          </div>
                          <strong>{tpl.type}</strong>
                          <ArrowUpRight size={14} />
                        </button>
                      ))}
                    </section>
                  </>
                )}
                {page === "campaigns" && (
                  <section className="surface">
                    <div className="toolbar">
                      <label className="search">
                        <Search size={17} />
                        <input
                          aria-label={t("Tìm chiến dịch")}
                          placeholder={t("Tìm tên, tiêu đề email…")}
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </label>
                      <select
                        aria-label={t("Lọc trạng thái chiến dịch")}
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      >
                        <option value="all">{t("Tất cả trạng thái")}</option>
                        {["draft", "queued", "completed", "cancelled"].map(
                          (v) => (
                            <option key={v} value={v}>
                              {label(v)}
                            </option>
                          ),
                        )}
                      </select>
                      <span className="small-muted">
                        {t("{n} chiến dịch", { n: filteredCampaigns.length })}
                      </span>
                    </div>
                    {filteredCampaigns.length ? (
                      <CampaignTable
                        rows={filteredCampaigns}
                        onOpen={setEditor}
                      />
                    ) : (
                      <Empty
                        title={
                          search || filter !== "all"
                            ? t("Chưa tìm thấy chiến dịch")
                            : t("Gửi đi câu chuyện đầu tiên")
                        }
                        description={t(
                          "Chiến dịch bạn tạo sẽ xuất hiện tại đây, từ bản nháp đến khi xử lý.",
                        )}
                        action={
                          write && (
                            <button
                              className="button"
                              onClick={() => newCampaign()}
                            >
                              <Plus size={16} />
                              {t("Tạo chiến dịch")}
                            </button>
                          )
                        }
                      />
                    )}
                  </section>
                )}
                {page === "contacts" && (
                  <>
                    <div className="info-line">
                      <ShieldCheck size={18} />
                      <span>
                        {t(
                          "Import không kích hoạt lại địa chỉ đã hủy nhận. Email marketing chỉ chọn liên hệ có nguồn đồng ý.",
                        )}
                      </span>
                      <button
                        className="text-button"
                        onClick={() =>
                          download(
                            "nep-mail-contacts.csv",
                            "email,name,tags,consent,consent_source\nminhanh@example.invalid,Nguyễn Minh Anh,khach-hang,true,Đăng ký thử nghiệm\n",
                            "text/csv;charset=utf-8",
                          )
                        }
                      >
                        <Download size={14} />
                        {t("CSV mẫu")}
                      </button>
                    </div>
                    <section className="surface">
                      <div className="toolbar">
                        <label className="search">
                          <Search size={17} />
                          <input
                            aria-label={t("Tìm liên hệ")}
                            placeholder={t("Tìm tên, email hoặc tag…")}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                        </label>
                        <select
                          aria-label={t("Lọc trạng thái liên hệ")}
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        >
                          <option value="all">{t("Tất cả liên hệ")}</option>
                          {["active", "unsubscribed", "suppressed"].map((v) => (
                            <option key={v} value={v}>
                              {label(v)}
                            </option>
                          ))}
                        </select>
                        <span className="small-muted">
                          {t("{n} liên hệ", { n: filteredContacts.length })}
                        </span>
                      </div>
                      {filteredContacts.length ? (
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>{t("Liên hệ")}</th>
                                <th>Tag</th>
                                <th>{t("Trạng thái")}</th>
                                <th>{t("Quyền nhận marketing")}</th>
                                <th>
                                  <span className="sr-only">
                                    {t("Thao tác")}
                                  </span>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredContacts.map((p) => (
                                <tr key={p.id}>
                                  <td>
                                    <div className="person-cell">
                                      <span className="person-avatar">
                                        {p.name[0]}
                                      </span>
                                      <div>
                                        <strong>{p.name}</strong>
                                        <small>{p.email}</small>
                                      </div>
                                    </div>
                                  </td>
                                  <td>
                                    <span className="tag-text">
                                      {p.tags || "—"}
                                    </span>
                                  </td>
                                  <td>
                                    <Badge value={p.status} />
                                  </td>
                                  <td>
                                    {p.consent ? (
                                      <span className="consent">
                                        <Check size={14} />
                                        {t("Đã đồng ý")}
                                        <small>{p.consent_source}</small>
                                      </span>
                                    ) : (
                                      <span className="small-muted">
                                        {t("Chưa cấp quyền")}
                                      </span>
                                    )}
                                  </td>
                                  <td>
                                    {write && p.status === "active" && (
                                      <button
                                        className="text-button danger"
                                        onClick={() =>
                                          setConfirm({
                                            text: t(
                                              "Chặn gửi đến {email}? Địa chỉ này sẽ bị loại khỏi những lần xử lý tiếp theo.",
                                              { email: p.email },
                                            ),
                                            run: async () => {
                                              await mutate(
                                                `contacts/${p.id}`,
                                                "PATCH",
                                                { status: "suppressed" },
                                              );
                                              notice(t("Đã chặn liên hệ"));
                                            },
                                          })
                                        }
                                      >
                                        {t("Chặn gửi")}
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <Empty
                          icon={Users}
                          title={t("Danh bạ bắt đầu từ sự đồng ý")}
                          description={t(
                            "Thêm từng liên hệ hoặc nhập CSV với thông tin nguồn đăng ký.",
                          )}
                          action={
                            write && (
                              <button
                                className="button"
                                onClick={() => setModal("contact")}
                              >
                                <Plus size={16} />
                                {t("Thêm hoặc nhập liên hệ")}
                              </button>
                            )
                          }
                        />
                      )}
                    </section>
                    <p className="footnote">
                      {t(
                        "Bản alpha hiển thị tối đa 501 liên hệ; xếp hàng giới hạn 500 liên hệ/workspace.",
                      )}
                    </p>
                  </>
                )}
                {page === "templates" && (
                  <>
                    <div className="template-intro">
                      <span className="small-label">{t("4 MẪU KHỞI ĐẦU")}</span>
                      <p>
                        {t(
                          "Email được tạo bằng HTML gọn nhẹ, có phiên bản văn bản và liên kết hủy nhận. Nội dung mẫu cần được bạn chỉnh trước khi gửi.",
                        )}
                      </p>
                    </div>
                    <div className="templates-grid">
                      {templates.map((tpl) => (
                        <article className="template-card" key={tpl.name}>
                          <div
                            className="template-art"
                            style={{ background: tpl.accent }}
                          >
                            <div className="template-paper">
                              <span className="paper-logo">nếp.</span>
                              <span className="template-category">
                                {tpl.type}
                              </span>
                              <h3 style={{ whiteSpace: "pre-line" }}>
                                {tpl.art}
                              </h3>
                              <div className="paper-line long" />
                              <div className="paper-line" />
                              <div className="paper-line long" />
                              <span className="paper-cta" />
                              <div className="paper-footer">
                                {t("ĐƯỢC GỬI VỚI SỰ CHĂM CHÚT")}
                              </div>
                            </div>
                          </div>
                          <div className="template-card-bottom">
                            <div>
                              <small>{tpl.type}</small>
                              <h2>{tpl.name}</h2>
                            </div>
                            <button
                              className="button"
                              disabled={!write}
                              onClick={() => newCampaign(tpl)}
                            >
                              {t("Dùng mẫu")}
                              <ArrowRight size={15} />
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </>
                )}
                {page === "integrations" && (
                  <>
                    <div className="integration-grid">
                      {[
                        {
                          name: "Nếp HR",
                          initial: "hr",
                          description: t(
                            "Đồng bộ danh bạ nhân sự và nguồn dữ liệu cho bản tin nội bộ.",
                          ),
                          source: "nep_hr",
                        },
                        {
                          name: "Nếp Business",
                          initial: "b",
                          description: t(
                            "Đồng bộ khách hàng để chuẩn bị chiến dịch chăm sóc và marketing.",
                          ),
                          source: "nep_business",
                        },
                      ].map((s) => (
                        <section className="integration-card" key={s.name}>
                          <span className="app-logo">
                            {t("nếp")}
                            <span>{s.initial}</span>
                          </span>
                          <h2>{s.name}</h2>
                          <p>{s.description}</p>
                          <div className="integration-state">
                            <span className="neutral-dot" />
                            {t("Chưa kết nối hệ thống thực")}
                          </div>
                          <small>
                            {t(
                              "API đã có hợp đồng nhận sự kiện. Cần cấu hình ở ứng dụng nguồn.",
                            )}
                          </small>
                        </section>
                      ))}
                    </div>
                    <section className="surface">
                      <div className="section-heading">
                        <h2>API key theo workspace</h2>
                        {admin && (
                          <button
                            className="button"
                            onClick={() => setModal("key")}
                          >
                            <Plus size={16} />
                            {t("Tạo API key")}
                          </button>
                        )}
                      </div>
                      <div className="api-description">
                        <code>
                          POST{" "}
                          {typeof window !== "undefined"
                            ? window.location.origin
                            : ""}
                          /api/v1/events
                        </code>
                        <p>
                          {t(
                            "Token chỉ được gửi sự kiện danh bạ trong workspace này. Hệ thống nguồn không được tự cấp quyền nhận marketing. Mỗi sự kiện cần một ID duy nhất để chống xử lý trùng.",
                          )}
                        </p>
                      </div>
                      {data.keys.length ? (
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>{t("Tên kết nối")}</th>
                                <th>{t("Nguồn")}</th>
                                <th>{t("Trạng thái")}</th>
                                <th>{t("Tạo lúc")}</th>
                                <th>{t("Thao tác")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {data.keys.map((k: Item) => (
                                <tr key={k.id}>
                                  <td>
                                    <strong>{k.name}</strong>
                                  </td>
                                  <td>{k.source}</td>
                                  <td>
                                    {k.revoked_at
                                      ? t("Đã thu hồi")
                                      : t("Đang hiệu lực")}
                                  </td>
                                  <td>{date(k.created_at)}</td>
                                  <td>
                                    {admin && !k.revoked_at && (
                                      <button
                                        className="text-button danger"
                                        onClick={() =>
                                          setConfirm({
                                            text: t(
                                              "Thu hồi key “{name}”? Ứng dụng đang dùng key sẽ ngừng đồng bộ.",
                                              { name: k.name },
                                            ),
                                            run: async () => {
                                              await mutate(
                                                `keys/${k.id}`,
                                                "DELETE",
                                              );
                                              notice(t("Đã thu hồi API key"));
                                            },
                                          })
                                        }
                                      >
                                        <Trash2 size={14} />
                                        {t("Thu hồi")}
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <Empty
                          icon={Plug}
                          title={t("Kết nối theo cách của bạn")}
                          description={t(
                            "Tạo API key riêng cho Nếp HR, Nếp Business hoặc một ứng dụng khác.",
                          )}
                        />
                      )}
                    </section>
                    <div className="info-line">
                      <ShieldCheck size={18} />
                      <span>
                        {t(
                          "Bản riêng tư yêu cầu thêm quyền truy cập ở lớp hosting. API token không tự vượt qua cổng đăng nhập của hosting.",
                        )}
                      </span>
                    </div>
                  </>
                )}
                {page === "settings" && (
                  <div className="settings-grid">
                    <section className="surface">
                      <div className="section-heading">
                        <h2>{t("Ngôn ngữ")}</h2>
                        <span className="small-muted">
                          {t("{n} ngôn ngữ", { n: LOCALES.length })}
                        </span>
                      </div>
                      <div className="settings-content">
                        <p>
                          {t(
                            "Giao diện đổi ngay khi chọn. Email dùng ngôn ngữ riêng của từng chiến dịch, kể cả trang hủy nhận.",
                          )}
                        </p>
                        <label>
                          {t("Ngôn ngữ giao diện")}
                          <select
                            value={locale}
                            onChange={(e) =>
                              changeLocale(e.target.value as LocaleCode)
                            }
                          >
                            {LOCALES.map((l) => (
                              <option key={l.code} value={l.code}>
                                {l.native} · {l.english}
                              </option>
                            ))}
                          </select>
                        </label>
                        <p className="footnote">
                          {t(
                            "Bản dịch do cộng đồng đóng góp. Chuỗi chưa dịch sẽ hiển thị bằng tiếng Anh, rồi tiếng Việt.",
                          )}
                        </p>
                      </div>
                    </section>
                    <section className="surface">
                      <div className="section-heading">
                        <h2>{t("Biểu mẫu đăng ký")}</h2>
                        {admin && (
                          <button
                            className="button"
                            onClick={() => setModal("form")}
                          >
                            <Plus size={16} /> {t("Tạo biểu mẫu")}
                          </button>
                        )}
                      </div>
                      <div className="settings-content">
                        <p>
                          {t(
                            "Double opt-in: liên hệ chỉ nhận marketing sau khi bấm xác nhận trong email. Người đăng ký không cần tài khoản.",
                          )}
                        </p>
                        {data.forms?.length ? (
                          <div className="member-list">
                            {data.forms.map((f: Item) => (
                              <div key={f.id}>
                                <strong>{f.name}</strong>
                                <small className="small-muted">
                                  {window.location.origin}/signup/{f.slug}
                                </small>
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    task(async () => {
                                      await navigator.clipboard.writeText(
                                        `${window.location.origin}/signup/${f.slug}`,
                                      );
                                      notice(t("Đã sao chép liên kết"));
                                    })
                                  }
                                >
                                  <Copy size={14} /> {t("Sao chép")}
                                </button>
                                {admin && (
                                  <button
                                    className="text-button danger"
                                    onClick={() =>
                                      setConfirm({
                                        text: t(
                                          "Xoá biểu mẫu “{name}”? Liên kết công khai sẽ ngừng hoạt động.",
                                          { name: f.name },
                                        ),
                                        run: async () => {
                                          await mutate(
                                            `forms/${f.id}`,
                                            "DELETE",
                                          );
                                          notice(t("Đã xoá biểu mẫu"));
                                        },
                                      })
                                    }
                                  >
                                    <Trash2 size={14} /> {t("Xoá")}
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="footnote">
                            {t(
                              "Chưa có biểu mẫu nào. Tạo một biểu mẫu để nhận đăng ký có xác nhận.",
                            )}
                          </p>
                        )}
                      </div>
                    </section>
                    <section className="surface">
                      <div className="section-heading">
                        <h2>{t("Tên miền & DNS")}</h2>
                        {dns && (
                          <span
                            className={
                              dns.ready ? "status-ready" : "status-pending"
                            }
                          >
                            {dns.ready ? t("Sẵn sàng") : t("Chưa sẵn sàng")}
                          </span>
                        )}
                      </div>
                      <div className="settings-content">
                        <p>
                          {t(
                            "Kiểm tra SPF, DKIM và DMARC trước khi bật gửi ra Internet. Kết quả đọc trực tiếp từ DNS công khai.",
                          )}
                        </p>
                        <label>
                          {t("Tên miền gửi")}
                          <input
                            value={dnsDomain}
                            onChange={(e) => setDnsDomain(e.target.value)}
                            placeholder="your-domain.vn"
                            maxLength={253}
                          />
                        </label>
                        <div
                          className="dialog-actions"
                          style={{ justifyContent: "flex-start" }}
                        >
                          <button
                            className="button"
                            disabled={dnsBusy || dnsDomain.trim().length < 4}
                            onClick={() => {
                              setDnsBusy(true);
                              setDns(null);
                              request(
                                `workspaces/${workspace}/dns?domain=${encodeURIComponent(
                                  dnsDomain.trim(),
                                )}&selector=nep`,
                              )
                                .then(setDns)
                                .catch((e) => notice(e.message))
                                .finally(() => setDnsBusy(false));
                            }}
                          >
                            {dnsBusy ? (
                              <Loader2 className="spin" size={16} />
                            ) : (
                              <Globe size={16} />
                            )}{" "}
                            {t("Kiểm tra DNS")}
                          </button>
                          {admin && (
                            <button
                              className="button"
                              disabled={dnsBusy || dnsDomain.trim().length < 4}
                              onClick={() =>
                                task(async () => {
                                  const r = await request(
                                    `workspaces/${workspace}/dkim`,
                                    "POST",
                                    {
                                      domain: dnsDomain.trim(),
                                      selector: "nep",
                                    },
                                  );
                                  setDkim(r);
                                })
                              }
                            >
                              <ShieldCheck size={16} /> {t("Tạo khoá DKIM")}
                            </button>
                          )}
                        </div>
                        {dns && (
                          <div className="member-list">
                            {dns.checks.map((check: Item) => (
                              <div key={check.id}>
                                <span
                                  className={
                                    check.status === "ok"
                                      ? "edition-dot"
                                      : "neutral-dot"
                                  }
                                />
                                <strong>{t(dnsLabel(check.id))}</strong>
                                <small className="small-muted">
                                  {check.reason
                                    ? t(dnsReason(check.reason))
                                    : check.status === "ok"
                                      ? t("Đạt")
                                      : t("Cảnh báo")}
                                </small>
                                {check.records?.length > 0 && (
                                  <small className="tag-text">
                                    {String(check.records[0]).slice(0, 90)}
                                  </small>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        <p className="footnote">
                          {t(
                            "Khoá riêng DKIM chỉ hiển thị một lần và không được lưu trong cơ sở dữ liệu. Đặt nó vào tệp mà DKIM_PRIVATE_KEY_FILE trỏ tới.",
                          )}
                        </p>
                      </div>
                    </section>
                    <section className="surface">
                      <div className="section-heading">
                        <h2>{t("Hạ tầng gửi tự vận hành")}</h2>
                        <span
                          className={
                            delivery?.ready ? "status-ready" : "status-pending"
                          }
                        >
                          {delivery?.ready
                            ? t("Sẵn sàng")
                            : t("Chưa mở gửi Internet")}
                        </span>
                      </div>
                      <div className="settings-content">
                        <p>
                          {t(
                            "Nếp Mail kết nối SMTP do bạn vận hành. Bộ self-host có Postfix gửi trực tiếp, không yêu cầu tài khoản hay API key dịch vụ gửi thuê ngoài.",
                          )}
                        </p>
                        <dl className="settings-list">
                          <div>
                            <dt>{t("Địa chỉ gửi")}</dt>
                            <dd>{delivery?.sender || t("Chưa cấu hình")}</dd>
                          </div>
                          <div>
                            <dt>{t("Chế độ hiện tại")}</dt>
                            <dd>
                              {delivery?.mode === "private-preview"
                                ? t("Xem thử riêng tư")
                                : "Self-host"}
                            </dd>
                          </div>
                          <div>
                            <dt>{t("Hộp thư thử cục bộ")}</dt>
                            <dd>
                              {delivery?.captureAvailable
                                ? t("Đã bật")
                                : t("Có trong bộ self-host")}
                            </dd>
                          </div>
                          <div>
                            <dt>{t("Lịch xử lý tự động")}</dt>
                            <dd>{t("Self-host: mỗi 10 giây khi bật gửi")}</dd>
                          </div>
                        </dl>
                        {delivery?.reasons?.map((r: string) => (
                          <div className="setup-reason" key={r}>
                            <span /> {r}
                          </div>
                        ))}
                        <p className="footnote">
                          {t(
                            "Phần mềm miễn phí; tên miền, máy chủ và kết nối Internet do bạn chuẩn bị. Khả năng đến inbox phụ thuộc cấu hình và uy tín gửi.",
                          )}
                        </p>
                      </div>
                    </section>
                    <section className="surface">
                      <div className="section-heading">
                        <h2>{t("Thành viên & phân quyền")}</h2>
                      </div>
                      <div className="settings-content">
                        <div className="member-list">
                          {data.members.map((m: Item) => (
                            <div key={m.id}>
                              <span className="person-avatar">
                                {m.email[0].toUpperCase()}
                              </span>
                              <strong>{m.email}</strong>
                              <span className="small-muted">
                                {labels[m.role]}
                              </span>
                            </div>
                          ))}
                        </div>
                        {admin && (
                          <form
                            className="member-form"
                            onSubmit={(e) => {
                              e.preventDefault();
                              const f = e.currentTarget,
                                p = new FormData(f);
                              task(async () => {
                                await mutate("members", "POST", {
                                  email: p.get("email"),
                                  role: p.get("role"),
                                });
                                f.reset();
                                notice(
                                  t(
                                    "Đã lưu phân quyền. Người dùng còn cần được cấp quyền truy cập ở lớp hosting.",
                                  ),
                                );
                              });
                            }}
                          >
                            <label>
                              {t("Email thành viên")}
                              <input
                                name="email"
                                type="email"
                                required
                                placeholder="ten@doanhnghiep.vn"
                              />
                            </label>
                            <label>
                              {t("Vai trò")}
                              <select name="role">
                                <option value="viewer">{t("Chỉ xem")}</option>
                                <option value="editor">
                                  {t("Biên tập viên")}
                                </option>
                                <option value="admin">
                                  {t("Quản trị viên")}
                                </option>
                              </select>
                            </label>
                            <button className="button" disabled={busy}>
                              {t("Lưu phân quyền")}
                            </button>
                          </form>
                        )}
                        <p className="footnote">
                          {t(
                            "Self-host alpha sử dụng một tài khoản quản trị. Đăng nhập nhiều tài khoản độc lập cần adapter xác thực bổ sung.",
                          )}
                        </p>
                      </div>
                    </section>
                    <section className="surface audit-section">
                      <div className="section-heading">
                        <h2>{t("Nhật ký hoạt động")}</h2>
                        <span className="small-muted">
                          {t("80 sự kiện gần nhất")}
                        </span>
                      </div>
                      <div className="audit-list">
                        {data.audit.map((a: Item) => (
                          <div key={a.id}>
                            <span className="audit-dot" />
                            <div>
                              <strong>{a.action}</strong>
                              <p>{a.detail}</p>
                              <small>{a.actor}</small>
                            </div>
                            <time>{date(a.created_at)}</time>
                          </div>
                        ))}
                      </div>
                    </section>
                    <section className="release-note" id="release">
                      <ShieldCheck size={23} />
                      <div>
                        <h2>
                          {t("Alpha để kiểm chứng. Chưa phải bản thương mại.")}
                        </h2>
                        <p>
                          {t(
                            "Đã có lõi danh bạ, chiến dịch, hàng đợi, phân quyền và hợp đồng tích hợp. Các cổng còn thiếu gồm kiểm chứng SMTP ra Internet, thu nhận bounce/complaint, khôi phục backup và rà soát bảo mật độc lập. Giấy phép mở nguồn cần được chốt trước khi công khai repo.",
                          )}
                        </p>
                      </div>
                    </section>
                  </div>
                )}
              </>
            )
          )}
          <footer className="app-footer">
            <span>
              {t("nếp mail")}
              <span>·</span>
              {t("Gửi điều có ý nghĩa.")}
            </span>
            <span>
              {t("Độc lập. Tự vận hành. Không dịch vụ gửi bắt buộc.")}
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label={t("Đóng thông báo")}
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {modal === "workspace" && (
        <Dialog title={t("Tạo workspace")} onClose={() => setModal(null)}>
          <form
            className="dialog-form"
            onSubmit={(e) => {
              e.preventDefault();
              const name = new FormData(e.currentTarget).get("name");
              task(async () => {
                const r = await request("workspaces", "POST", { name });
                await loadBoot();
                setWorkspace(r.id);
                setModal(null);
                notice(t("Workspace mới đã sẵn sàng"));
              });
            }}
          >
            <p>
              {t(
                "Mỗi workspace có danh bạ, chiến dịch và quyền truy cập riêng.",
              )}
            </p>
            <label>
              {t("Tên workspace")}
              <input
                name="name"
                required
                minLength={2}
                maxLength={100}
                autoFocus
                placeholder={t("Ví dụ: Công ty của bạn")}
              />
            </label>
            <div className="dialog-actions">
              <button
                type="button"
                className="button"
                onClick={() => setModal(null)}
              >
                {t("Để sau")}
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? (
                  <Loader2 className="spin" size={16} />
                ) : (
                  <Plus size={16} />
                )}{" "}
                {t("Tạo workspace")}
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {modal === "contact" && (
        <ContactDialog
          onClose={() => setModal(null)}
          busy={busy}
          onSave={(p, importing) =>
            task(async () => {
              const r = await mutate(
                importing ? "contacts/import" : "contacts",
                "POST",
                p,
              );
              setModal(null);
              notice(
                importing
                  ? t("Đã xử lý {rows} dòng, {unique} email riêng biệt", {
                      rows: r.processed,
                      unique: r.unique,
                    })
                  : t("Đã lưu liên hệ"),
              );
            })
          }
        />
      )}
      {modal === "key" && (
        <Dialog title={t("Tạo API key")} onClose={() => setModal(null)}>
          <form
            className="dialog-form"
            onSubmit={(e) => {
              e.preventDefault();
              const p = new FormData(e.currentTarget);
              task(async () => {
                const r = await mutate("keys", "POST", {
                  name: p.get("name"),
                  source: p.get("source"),
                });
                setModal(null);
                setToken(r.token);
              });
            }}
          >
            <p>
              {t(
                "Key chỉ được hiển thị một lần. Lưu ở máy chủ của ứng dụng nguồn.",
              )}
            </p>
            <label>
              {t("Tên kết nối")}
              <input
                name="name"
                minLength={2}
                maxLength={80}
                required
                placeholder={t("Đồng bộ danh bạ Nếp HR")}
              />
            </label>
            <label>
              {t("Ứng dụng nguồn")}
              <select name="source">
                <option value="nep_hr">Nếp HR</option>
                <option value="nep_business">Nếp Business</option>
                <option value="custom">{t("Ứng dụng khác")}</option>
              </select>
            </label>
            <div className="dialog-actions">
              <button className="button primary" disabled={busy}>
                {t("Tạo key")}
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {modal === "form" && (
        <Dialog title={t("Tạo biểu mẫu")} onClose={() => setModal(null)}>
          <form
            className="dialog-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              task(async () => {
                const created = await mutate("forms", "POST", {
                  name: f.get("name"),
                  tag: f.get("tag"),
                  consentSource: f.get("consentSource"),
                  locale: f.get("locale"),
                });
                setModal(null);
                await navigator.clipboard
                  .writeText(`${window.location.origin}/signup/${created.slug}`)
                  .catch(() => undefined);
                notice(t("Đã tạo biểu mẫu và sao chép liên kết công khai"));
              });
            }}
          >
            <p>
              {t(
                "Biểu mẫu công khai không cần đăng nhập: người đọc nhập tên và email, nhận thư xác nhận, rồi bấm một liên kết. Chỉ sau đó liên hệ mới được tính là đồng ý.",
              )}
            </p>
            <label>
              {t("Tên biểu mẫu")}
              <input
                name="name"
                required
                minLength={2}
                maxLength={100}
                autoFocus
                placeholder={t("Bản tin hàng tháng")}
              />
            </label>
            <label>
              {t("Tag người nhận")}
              <input name="tag" maxLength={100} placeholder="ban-tin" />
            </label>
            <label>
              {t("Nguồn đồng ý ghi vào liên hệ")}
              <input
                name="consentSource"
                required
                minLength={3}
                maxLength={300}
                placeholder={t("Biểu mẫu trên website, ngày xác nhận")}
              />
            </label>
            <label>
              {t("Ngôn ngữ email")}
              <select name="locale" defaultValue={locale}>
                {LOCALES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.native}
                  </option>
                ))}
              </select>
            </label>
            <div className="dialog-actions">
              <button
                type="button"
                className="button"
                onClick={() => setModal(null)}
              >
                {t("Hủy")}
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? (
                  <Loader2 className="spin" size={16} />
                ) : (
                  <Plus size={16} />
                )}{" "}
                {t("Tạo biểu mẫu")}
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {dkim && (
        <Dialog title={t("Khoá DKIM mới")} onClose={() => setDkim(null)} wide>
          <div className="dialog-form">
            <p>
              {t(
                "Thêm bản ghi TXT dưới đây vào DNS, rồi lưu khoá riêng vào tệp mà DKIM_PRIVATE_KEY_FILE trỏ tới. Khoá không được lưu trong cơ sở dữ liệu và sẽ không hiển thị lại.",
              )}
            </p>
            <label>
              {t("Tên bản ghi")}
              <input readOnly value={dkim.dnsName} />
            </label>
            <label>
              {t("Giá trị TXT")}
              <textarea readOnly rows={4} value={dkim.dnsValue} />
            </label>
            <div className="dialog-actions">
              <button
                className="button"
                onClick={() =>
                  task(async () => {
                    await navigator.clipboard.writeText(dkim.dnsValue);
                    notice(t("Đã sao chép bản ghi DNS"));
                  })
                }
              >
                <Copy size={16} /> {t("Sao chép")}
              </button>
              <button
                className="button"
                onClick={() =>
                  download(String(dkim.fileName), String(dkim.privateKeyPem))
                }
              >
                <Download size={16} /> {t("Tải khoá riêng")}
              </button>
              <button className="button primary" onClick={() => setDkim(null)}>
                {t("Tôi đã lưu")}
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {token && (
        <Dialog title={t("Lưu API key của bạn")} onClose={() => setToken("")}>
          <div className="dialog-form">
            <p>{t("Key sẽ không hiển thị lại sau khi đóng cửa sổ này.")}</p>
            <code className="secret-token">{token}</code>
            <button
              className="button"
              onClick={() =>
                task(async () => {
                  await navigator.clipboard.writeText(token);
                  notice(t("Đã sao chép API key"));
                })
              }
            >
              <Copy size={16} />
              {t("Sao chép key")}
            </button>
            <div className="dialog-actions">
              <button className="button primary" onClick={() => setToken("")}>
                {t("Tôi đã lưu key")}
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {confirm && (
        <Dialog title={t("Xác nhận thao tác")} onClose={() => setConfirm(null)}>
          <div className="dialog-form">
            <p>{confirm.text}</p>
            <div className="dialog-actions">
              <button className="button" onClick={() => setConfirm(null)}>
                {t("Quay lại")}
              </button>
              <button
                className="button destructive"
                disabled={busy}
                onClick={() =>
                  task(async () => {
                    await confirm.run();
                    setConfirm(null);
                  })
                }
              >
                {t("Xác nhận")}
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {editor && (
        <CampaignEditor
          value={editor}
          brand={data?.workspace?.name || t("Workspace của bạn")}
          canWrite={write}
          canProcess={admin}
          delivery={delivery}
          onClose={() => setEditor(null)}
          onSave={(p) =>
            task(async () => {
              const r = await mutate(
                editor.id ? `campaigns/${editor.id}` : "campaigns",
                editor.id ? "PATCH" : "POST",
                p,
              );
              setEditor({ ...p, id: editor.id || r.id, status: "draft" });
              notice(t("Đã lưu bản nháp"));
            })
          }
          onAction={(a, p) =>
            task(async () => {
              const result = await mutate(
                `campaigns/${editor.id}/${a}`,
                "POST",
                p || {},
              );
              if (a === "queue" || a === "cancel" || a === "process")
                setEditor(null);
              notice(
                a === "test"
                  ? t("Đã gửi vào hộp thư thử cục bộ")
                  : a === "queue"
                    ? t(
                        "Đã xếp hàng {n} người nhận. Gửi chỉ chạy khi cấu hình sẵn sàng.",
                        { n: result.queued },
                      )
                    : a === "cancel"
                      ? t("Đã hủy chiến dịch")
                      : t("Đã xử lý một đợt gửi"),
              );
            })
          }
          busy={busy}
          preflight={() => request(path(`campaigns/${editor.id}/preflight`))}
        />
      )}
    </div>
  );
}
function CampaignTable({
  rows,
  onOpen,
}: {
  rows: Item[];
  onOpen: (c: Item) => void;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{t("Chiến dịch")}</th>
            <th>{t("Trạng thái")}</th>
            <th>{t("Nhóm email")}</th>
            <th>
              {t("Cập nhật")}
              <ChevronDown size={12} />
            </th>
            <th>
              <span className="sr-only">{t("Mở")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>
                <button className="row-title" onClick={() => onOpen(c)}>
                  {c.name}
                </button>
                <small className="table-subtitle">{c.subject}</small>
              </td>
              <td>
                <Badge value={c.status} />
              </td>
              <td>
                <span className="small-muted">
                  {c.category === "marketing" ? "Marketing" : t("Nội bộ")}
                </span>
              </td>
              <td className="date-cell">{date(c.updated_at)}</td>
              <td>
                <button
                  className="icon-button"
                  aria-label={t("Mở") + c.name}
                  onClick={() => onOpen(c)}
                >
                  <ArrowUpRight size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function ContactDialog({
  onClose,
  onSave,
  busy,
}: {
  onClose: () => void;
  onSave: (p: unknown, importing: boolean) => void;
  busy: boolean;
}) {
  const [importing, setImporting] = useState(false),
    [csv, setCsv] = useState(""),
    [consent, setConsent] = useState(false),
    [fileError, setFileError] = useState("");
  return (
    <Dialog
      title={importing ? t("Nhập liên hệ từ CSV") : t("Thêm liên hệ")}
      onClose={onClose}
    >
      <div className="tabs">
        <button
          className={!importing ? "active" : ""}
          onClick={() => setImporting(false)}
        >
          {t("Một liên hệ")}
        </button>
        <button
          className={importing ? "active" : ""}
          onClick={() => setImporting(true)}
        >
          {t("Nhập CSV")}
        </button>
      </div>
      <form
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (importing) {
            onSave({ csv }, true);
            return;
          }
          const p = new FormData(e.currentTarget);
          onSave(
            {
              name: p.get("name"),
              email: p.get("email"),
              tags: p.get("tags"),
              consent,
              consentSource: p.get("consentSource") || "",
            },
            false,
          );
        }}
      >
        {importing ? (
          <>
            <p>
              {t("Cột bắt buộc:")}
              <code>email,name</code>. Cột tùy chọn:{" "}
              <code>tags,consent,consent_source</code>
              {t(". Tối đa 500 dòng mỗi lần.")}
            </p>
            <label>
              {t("Chọn tệp CSV")}
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    if (f.size > 500000) {
                      setFileError(t("Tệp tối đa 500 KB"));
                      return;
                    }
                    setFileError("");
                    setCsv(await f.text());
                  }
                }}
              />
            </label>
            {fileError && (
              <p className="danger" role="alert">
                {fileError}
              </p>
            )}
            <label>
              {t("Nội dung CSV")}
              <textarea
                rows={9}
                required
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                placeholder={
                  "email,name,tags,consent,consent_source\nminhanh@example.invalid,Nguyễn Minh Anh,khach-hang,false,"
                }
              />
            </label>
            <p className="footnote">
              {t(
                "Nếu có dòng lỗi, toàn bộ lần nhập bị từ chối. Liên hệ trùng được cập nhật tên và tag; không khôi phục quyền nhận của địa chỉ đã chặn.",
              )}
            </p>
          </>
        ) : (
          <>
            <label>
              {t("Họ và tên")}
              <input
                name="name"
                required
                maxLength={160}
                autoFocus
                placeholder="Nguyễn Minh Anh"
              />
            </label>
            <label>
              {t("Địa chỉ email")}
              <input
                name="email"
                type="email"
                required
                maxLength={254}
                placeholder="minhanh@doanhnghiep.vn"
              />
            </label>
            <label>
              Tag{" "}
              <span className="optional">{t("· phân cách bằng dấu phẩy")}</span>
              <input
                name="tags"
                maxLength={300}
                placeholder="khach-hang,ban-tin"
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>{t("Liên hệ đã đồng ý nhận email marketing")}</span>
            </label>
            {consent && (
              <label>
                {t("Nguồn đồng ý")}
                <input
                  name="consentSource"
                  required
                  minLength={3}
                  maxLength={500}
                  placeholder={t("Biểu mẫu đăng ký, ngày xác nhận…")}
                />
              </label>
            )}
          </>
        )}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            {t("Hủy")}
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <Check size={16} />
            )}{" "}
            {importing ? t("Kiểm tra & nhập") : t("Lưu liên hệ")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function CampaignEditor({
  value,
  brand,
  canWrite,
  canProcess,
  delivery,
  onClose,
  onSave,
  onAction,
  busy,
  preflight,
}: {
  value: Item;
  brand: string;
  canWrite: boolean;
  canProcess: boolean;
  delivery: Item;
  onClose: () => void;
  onSave: (p: Item) => void;
  onAction: (action: string, p?: Item) => void;
  busy: boolean;
  preflight: () => Promise<Item>;
}) {
  const [form, setForm] = useState<Item>({
      ...blank,
      ...value,
      audienceTag: value.audienceTag ?? value.audience_tag ?? "",
    }),
    [mobile, setMobile] = useState(false),
    [pre, setPre] = useState<Item | null>(null),
    [preError, setPreError] = useState(""),
    [schedule, setSchedule] = useState(""),
    [queueConfirm, setQueueConfirm] = useState(false);
  const editable = canWrite && (!value.status || value.status === "draft");
  const rendered = renderEmail(
    form as { subject: string; body: string; preheader: string },
    { name: "Nguyễn Minh Anh", email: "minhanh@example.invalid" },
    brand,
    "#preview-only",
    (form.locale || "vi") as LocaleCode,
  );
  useEffect(() => {
    let active = true;
    if (value.id) {
      preflight()
        .then((p) => {
          if (active) setPre(p);
        })
        .catch((e) => {
          if (active) setPreError(e.message);
        });
    }
    return () => {
      active = false;
    };
  }, [
    value.id,
    value.status,
    value.subject,
    value.body,
    value.audienceTag,
    value.audience_tag,
  ]);
  const set = (key: string, val: string) => {
    setForm((f) => ({ ...f, [key]: val }));
    setPre(null);
  };
  const dirty =
    ["name", "subject", "preheader", "body", "category", "locale"].some(
      (k) => form[k] !== { ...blank, ...value }[k],
    ) || form.audienceTag !== (value.audienceTag ?? value.audience_tag ?? "");
  return (
    <Dialog
      title={value.id ? t("Chi tiết chiến dịch") : t("Tạo chiến dịch mới")}
      onClose={onClose}
      wide
    >
      <div className="editor-layout">
        <form
          id="campaign-form"
          className="editor-form"
          onSubmit={(e) => {
            e.preventDefault();
            onSave({
              name: form.name,
              subject: form.subject,
              preheader: form.preheader,
              body: form.body,
              category: form.category,
              audienceTag: form.audienceTag,
              locale: form.locale || "vi",
            });
          }}
        >
          <div className="editor-kicker">
            <span className="small-label">{t("NỘI DUNG EMAIL")}</span>
            <Badge value={value.status || "draft"} />
          </div>
          <label>
            {t("Tên chiến dịch")}
            <input
              value={form.name}
              disabled={!editable}
              onChange={(e) => set("name", e.target.value)}
              minLength={2}
              maxLength={160}
              required
              placeholder={t("Bản tin tháng 10")}
              autoFocus
            />
          </label>
          <label>
            {t("Tiêu đề email")}
            <input
              value={form.subject}
              disabled={!editable}
              onChange={(e) => set("subject", e.target.value)}
              minLength={2}
              maxLength={200}
              required
              placeholder={t("Điều muốn gửi đến {{first_name}}")}
            />
          </label>
          <label>
            {t("Dòng xem trước")}
            <input
              value={form.preheader}
              disabled={!editable}
              onChange={(e) => set("preheader", e.target.value)}
              maxLength={300}
              placeholder={t("Một dòng ngắn xuất hiện bên cạnh tiêu đề")}
            />
          </label>
          <div className="form-columns">
            <label>
              {t("Nhóm email")}
              <select
                disabled={!editable}
                value={form.category}
                onChange={(e) => set("category", e.target.value)}
              >
                <option value="marketing">{t("Marketing · cần đồng ý")}</option>
                <option value="internal">{t("Thông tin nội bộ")}</option>
              </select>
            </label>
            <label>
              {t("Tag người nhận")}
              <input
                disabled={!editable}
                value={form.audienceTag}
                onChange={(e) => set("audienceTag", e.target.value)}
                maxLength={100}
                placeholder={t("Để trống: tất cả đủ điều kiện")}
              />
            </label>
            <label>
              {t("Ngôn ngữ email")}
              <select
                disabled={!editable}
                value={form.locale || "vi"}
                onChange={(e) => set("locale", e.target.value)}
              >
                {LOCALES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.native}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            {t("Nội dung")}
            <textarea
              disabled={!editable}
              rows={10}
              value={form.body}
              onChange={(e) => set("body", e.target.value)}
              minLength={10}
              maxLength={50000}
              required
              placeholder={t(
                "Chào {{first_name}},\n\nViết điều bạn muốn chia sẻ tại đây…",
              )}
            />
          </label>
          <p className="footnote">
            {t("Cá nhân hóa:")}
            <code>{"{{first_name}}"}</code>, <code>{"{{name}}"}</code>,{" "}
            <code>{"{{email}}"}</code>
            {t(". Nhập văn bản thuần, hệ thống tự tạo HTML.")}
          </p>
        </form>
        <section className="preview-pane">
          <div className="preview-toolbar">
            <span className="small-label">{t("XEM TRƯỚC")}</span>
            <div>
              <button
                className={!mobile ? "icon-button chosen" : "icon-button"}
                aria-label="Xem desktop"
                onClick={() => setMobile(false)}
              >
                <Monitor size={16} />
              </button>
              <button
                className={mobile ? "icon-button chosen" : "icon-button"}
                aria-label={t("Xem di động")}
                onClick={() => setMobile(true)}
              >
                <Smartphone size={16} />
              </button>
            </div>
          </div>
          <div className="preview-envelope">
            <span>{t("Đến: {name}", { name: "Nguyễn Minh Anh" })}</span>
            <strong>{rendered.subject || t("Tiêu đề email của bạn")}</strong>
          </div>
          <iframe
            className={mobile ? "email-frame mobile" : "email-frame"}
            title={t("Xem trước nội dung email")}
            sandbox=""
            srcDoc={rendered.html}
          />
          <div className="preview-foot">
            <ShieldCheck size={14} />
            <span>
              {t("Địa chỉ tổng hợp · Liên kết hủy nhận chỉ là bản xem trước")}
            </span>
          </div>
        </section>
      </div>
      <div className="editor-bottom">
        <div>
          {preError ? (
            <span className="danger">{preError}</span>
          ) : pre ? (
            <>
              <strong>
                {t("{n} người nhận đủ điều kiện", { n: pre.eligible })}
              </strong>
              <small>
                {t("{n} liên hệ bị loại", { n: pre.excluded })} ·{" "}
                {pre.deliveries
                  ?.map((d: Item) => `${deliveryLabel(d.status)}: ${d.n}`)
                  .join(" · ") || t("Chưa xếp hàng")}
              </small>
            </>
          ) : (
            <small>
              {dirty
                ? t("Lưu bản nháp để cập nhật kiểm tra người nhận.")
                : t("Lưu nội dung trước khi xếp hàng.")}
            </small>
          )}
        </div>
        <div className="editor-actions">
          <button
            className="button"
            onClick={() =>
              download("nep-mail-email.html", rendered.html, "text/html")
            }
          >
            <Download size={16} /> HTML
          </button>
          {value.id && delivery?.captureAvailable && canProcess && (
            <button
              className="button"
              disabled={busy || dirty}
              onClick={() => onAction("test")}
            >
              {t("Gửi vào hộp thư thử")}
            </button>
          )}
          {editable && (
            <button
              form="campaign-form"
              className="button primary"
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <Check size={16} />
              )}{" "}
              {t("Lưu bản nháp")}
            </button>
          )}
          {value.id && editable && (
            <button
              className="button"
              disabled={busy || dirty}
              onClick={() => {
                preflight()
                  .then((p) => {
                    setPre(p);
                    setQueueConfirm(true);
                  })
                  .catch((e) => setPreError(e.message));
              }}
            >
              {t("Kiểm tra & xếp hàng")}
              <ArrowRight size={15} />
            </button>
          )}
          {value.status === "queued" && canWrite && (
            <button
              className="button destructive"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(t("Hủy những thư chưa được SMTP tiếp nhận?"))
                )
                  onAction("cancel");
              }}
            >
              {t("Hủy chiến dịch")}
            </button>
          )}
          {value.status === "queued" && canProcess && (
            <button
              className="button primary"
              disabled={busy || !delivery?.ready}
              onClick={() => onAction("process")}
            >
              {t("Xử lý 10 thư")}
            </button>
          )}
        </div>
      </div>
      {queueConfirm && (
        <div className="queue-confirm">
          <div>
            <h3>{t("Xác nhận chốt người nhận")}</h3>
            <p>
              {t(
                "{n} liên hệ đủ điều kiện sẽ được chốt thành danh sách gửi. Nội dung sẽ khóa sau khi xếp hàng.",
                { n: pre?.eligible ?? 0 },
              )}
            </p>
            {!delivery?.ready && (
              <p className="danger">
                {t(
                  "Gửi Internet đang tắt. Thư ở trạng thái chờ cho đến khi cấu hình sẵn sàng.",
                )}
              </p>
            )}
          </div>
          <label>
            {t("Thời gian gửi")}{" "}
            <span className="optional">
              {t("· bỏ trống để xử lý ngay khi sẵn sàng")}
            </span>
            <input
              type="datetime-local"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
            />
          </label>
          <div className="dialog-actions">
            <button className="button" onClick={() => setQueueConfirm(false)}>
              {t("Quay lại")}
            </button>
            <button
              className="button primary"
              disabled={busy || !pre?.eligible}
              onClick={() =>
                onAction(
                  "queue",
                  schedule
                    ? { scheduledAt: new Date(schedule).toISOString() }
                    : {},
                )
              }
            >
              {t("Xác nhận xếp hàng")}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
