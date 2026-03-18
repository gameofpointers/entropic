export type FigmaRecipeStep = {
  tool: string;
  saveAs?: string;
  args: Record<string, unknown> | ((ctx: Record<string, string>) => Record<string, unknown>);
};

export type FigmaRecipe = {
  id: string;
  label: string;
  summary: string;
  matchers: RegExp[];
  steps: FigmaRecipeStep[];
};

export const FIGMA_RECIPES: FigmaRecipe[] = [
  {
    id: "dashboard-shell",
    label: "Dashboard Shell",
    summary: "Left nav, KPI cards, chart panel, and activity list.",
    matchers: [/dashboard/i, /analytics/i, /kpi/i],
    steps: [
      { tool: "create_shape", saveAs: "shell", args: { type: "FRAME", x: 64, y: 64, width: 1280, height: 820, name: "Dashboard Shell" } },
      { tool: "set_fill", args: (ctx) => ({ id: ctx.shell, color: "#F4F7FB" }) },
      { tool: "create_shape", saveAs: "nav", args: (ctx) => ({ type: "FRAME", parent_id: ctx.shell, x: 0, y: 0, width: 250, height: 820, name: "Left Nav" }) },
      { tool: "set_fill", args: (ctx) => ({ id: ctx.nav, color: "#0F172A" }) },
      { tool: "create_shape", saveAs: "content", args: (ctx) => ({ type: "FRAME", parent_id: ctx.shell, x: 282, y: 38, width: 950, height: 744, name: "Content" }) },
      { tool: "set_fill", args: (ctx) => ({ id: ctx.content, color: "#FFFFFF" }) },
      { tool: "set_radius", args: (ctx) => ({ id: ctx.content, radius: 28 }) },
      { tool: "create_shape", saveAs: "headline", args: (ctx) => ({ type: "TEXT", parent_id: ctx.content, x: 32, y: 30, width: 500, height: 48, name: "Headline" }) },
      { tool: "set_text", args: (ctx) => ({ id: ctx.headline, text: "Revenue dashboard" }) },
      { tool: "set_font", args: (ctx) => ({ id: ctx.headline, size: 32, style: "Bold" }) },
      { tool: "create_shape", saveAs: "subtitle", args: (ctx) => ({ type: "TEXT", parent_id: ctx.content, x: 32, y: 78, width: 420, height: 28, name: "Subtitle" }) },
      { tool: "set_text", args: (ctx) => ({ id: ctx.subtitle, text: "Weekly performance across product, growth, and retention." }) },
      { tool: "set_font", args: (ctx) => ({ id: ctx.subtitle, size: 15, style: "Regular" }) },
      { tool: "create_shape", saveAs: "cardA", args: (ctx) => ({ type: "FRAME", parent_id: ctx.content, x: 32, y: 136, width: 275, height: 148, name: "MRR Card" }) },
      { tool: "set_fill", args: (ctx) => ({ id: ctx.cardA, color: "#E0F2FE" }) },
      { tool: "set_radius", args: (ctx) => ({ id: ctx.cardA, radius: 24 }) },
      { tool: "create_shape", saveAs: "cardATitle", args: (ctx) => ({ type: "TEXT", parent_id: ctx.cardA, x: 20, y: 18, width: 120, height: 24, name: "Card Label" }) },
      { tool: "set_text", args: (ctx) => ({ id: ctx.cardATitle, text: "Monthly recurring revenue" }) },
      { tool: "set_font", args: (ctx) => ({ id: ctx.cardATitle, size: 13, style: "Regular" }) },
      { tool: "create_shape", saveAs: "cardAValue", args: (ctx) => ({ type: "TEXT", parent_id: ctx.cardA, x: 20, y: 60, width: 180, height: 48, name: "Card Value" }) },
      { tool: "set_text", args: (ctx) => ({ id: ctx.cardAValue, text: "$148.2K" }) },
      { tool: "set_font", args: (ctx) => ({ id: ctx.cardAValue, size: 34, style: "Bold" }) },
      { tool: "create_shape", saveAs: "chart", args: (ctx) => ({ type: "FRAME", parent_id: ctx.content, x: 32, y: 320, width: 580, height: 366, name: "Chart Panel" }) },
      { tool: "set_fill", args: (ctx) => ({ id: ctx.chart, color: "#F8FAFC" }) },
      { tool: "set_radius", args: (ctx) => ({ id: ctx.chart, radius: 24 }) },
      { tool: "create_shape", saveAs: "activity", args: (ctx) => ({ type: "FRAME", parent_id: ctx.content, x: 644, y: 136, width: 274, height: 550, name: "Activity Panel" }) },
      { tool: "set_fill", args: (ctx) => ({ id: ctx.activity, color: "#F8FAFC" }) },
      { tool: "set_radius", args: (ctx) => ({ id: ctx.activity, radius: 24 }) },
    ],
  },
  {
    id: "mobile-onboarding",
    label: "Mobile Onboarding",
    summary: "Phone frame with title, body copy, and CTA.",
    matchers: [/mobile/i, /onboard/i, /signup/i, /intro/i],
    steps: [
      { tool: "create_shape", saveAs: "phone", args: { type: "FRAME", x: 160, y: 80, width: 390, height: 844, name: "Phone" } },
      { tool: "set_fill", args: (ctx) => ({ id: ctx.phone, color: "#FFF7ED", color_end: "#FFE4E6", gradient: "top-bottom" }) },
      { tool: "set_radius", args: (ctx) => ({ id: ctx.phone, radius: 36 }) },
      { tool: "create_shape", saveAs: "hero", args: (ctx) => ({ type: "FRAME", parent_id: ctx.phone, x: 32, y: 48, width: 326, height: 300, name: "Hero Card" }) },
      { tool: "set_fill", args: (ctx) => ({ id: ctx.hero, color: "#FFFFFF" }) },
      { tool: "set_radius", args: (ctx) => ({ id: ctx.hero, radius: 28 }) },
      { tool: "create_shape", saveAs: "title", args: (ctx) => ({ type: "TEXT", parent_id: ctx.phone, x: 36, y: 390, width: 300, height: 90, name: "Title" }) },
      { tool: "set_text", args: (ctx) => ({ id: ctx.title, text: "Ship better work with one calm command center." }) },
      { tool: "set_font", args: (ctx) => ({ id: ctx.title, size: 34, style: "Bold" }) },
      { tool: "create_shape", saveAs: "body", args: (ctx) => ({ type: "TEXT", parent_id: ctx.phone, x: 36, y: 500, width: 300, height: 80, name: "Body" }) },
      { tool: "set_text", args: (ctx) => ({ id: ctx.body, text: "Coordinate tasks, conversations, and design decisions without bouncing between tabs." }) },
      { tool: "set_font", args: (ctx) => ({ id: ctx.body, size: 16, style: "Regular" }) },
      { tool: "create_shape", saveAs: "cta", args: (ctx) => ({ type: "FRAME", parent_id: ctx.phone, x: 36, y: 700, width: 318, height: 64, name: "Primary CTA" }) },
      { tool: "set_fill", args: (ctx) => ({ id: ctx.cta, color: "#111827" }) },
      { tool: "set_radius", args: (ctx) => ({ id: ctx.cta, radius: 999 }) },
      { tool: "create_shape", saveAs: "ctaText", args: (ctx) => ({ type: "TEXT", parent_id: ctx.cta, x: 96, y: 18, width: 130, height: 28, name: "CTA Label" }) },
      { tool: "set_text", args: (ctx) => ({ id: ctx.ctaText, text: "Get started" }) },
      { tool: "set_font", args: (ctx) => ({ id: ctx.ctaText, size: 18, style: "Bold" }) },
    ],
  },
  {
    id: "pricing-page",
    label: "Pricing Page",
    summary: "Hero title, supporting copy, and three pricing cards.",
    matchers: [/pricing/i, /plans/i, /billing/i],
    steps: [
      { tool: "create_shape", saveAs: "page", args: { type: "FRAME", x: 80, y: 60, width: 1320, height: 920, name: "Pricing Page" } },
      { tool: "set_fill", args: (ctx) => ({ id: ctx.page, color: "#FCFCFD" }) },
      { tool: "create_shape", saveAs: "heroTitle", args: (ctx) => ({ type: "TEXT", parent_id: ctx.page, x: 110, y: 90, width: 720, height: 72, name: "Hero Title" }) },
      { tool: "set_text", args: (ctx) => ({ id: ctx.heroTitle, text: "Pricing built for teams that move fast." }) },
      { tool: "set_font", args: (ctx) => ({ id: ctx.heroTitle, size: 44, style: "Bold" }) },
      { tool: "create_shape", saveAs: "heroCopy", args: (ctx) => ({ type: "TEXT", parent_id: ctx.page, x: 110, y: 184, width: 640, height: 64, name: "Hero Copy" }) },
      { tool: "set_text", args: (ctx) => ({ id: ctx.heroCopy, text: "Start free, upgrade when your workflows need stronger collaboration, approvals, and shared context." }) },
      { tool: "set_font", args: (ctx) => ({ id: ctx.heroCopy, size: 18, style: "Regular" }) },
      { tool: "create_shape", saveAs: "starter", args: (ctx) => ({ type: "FRAME", parent_id: ctx.page, x: 110, y: 320, width: 320, height: 430, name: "Starter Plan" }) },
      { tool: "create_shape", saveAs: "pro", args: (ctx) => ({ type: "FRAME", parent_id: ctx.page, x: 470, y: 290, width: 360, height: 490, name: "Pro Plan" }) },
      { tool: "create_shape", saveAs: "enterprise", args: (ctx) => ({ type: "FRAME", parent_id: ctx.page, x: 870, y: 320, width: 320, height: 430, name: "Enterprise Plan" }) },
      { tool: "set_fill", args: (ctx) => ({ id: ctx.starter, color: "#FFFFFF" }) },
      { tool: "set_fill", args: (ctx) => ({ id: ctx.pro, color: "#111827" }) },
      { tool: "set_fill", args: (ctx) => ({ id: ctx.enterprise, color: "#FFFFFF" }) },
      { tool: "set_radius", args: (ctx) => ({ id: ctx.starter, radius: 28 }) },
      { tool: "set_radius", args: (ctx) => ({ id: ctx.pro, radius: 32 }) },
      { tool: "set_radius", args: (ctx) => ({ id: ctx.enterprise, radius: 28 }) },
    ],
  },
];

export function pickRecipe(prompt: string): FigmaRecipe {
  const trimmed = prompt.trim();
  return FIGMA_RECIPES.find((recipe) => recipe.matchers.some((matcher) => matcher.test(trimmed))) ?? FIGMA_RECIPES[0];
}
