-- 允许停用「环境变量兜底」的 Provider。
--
-- 这些 Provider 不是数据库行：只要 .env 里有对应的 key 与 base_url，它们就会被
-- 组装进列表（见 backend/gateway/src/services/provider-settings.ts 与
-- backend/go-gateway/internal/service/app_settings.go）。因此它们既没有可编辑的行，
-- 也无法通过 enabled 字段关闭——想关掉只能去删环境变量，而那会连模型一起弄丢，
-- 想再开就得改配置并重启。
--
-- 这里单独记「哪些 env Provider 被停用」，不碰环境变量：key 留在原处，随时可以再开。
-- 存 id 而不是整个 Provider，是为了让两侧（Node 与 Go）各自组装自己的结构，
-- 只共享同一份停用清单。
--
-- 顺序很重要：app_settings_key_check 是写入白名单，新键必须先加进约束，否则下面的
-- insert 会被约束拒绝，迁移直接失败。约束在写入时检查，跟列的默认值无关。

alter table public.app_settings drop constraint if exists app_settings_key_check;
alter table public.app_settings add constraint app_settings_key_check check (
  key in (
    'image_credit_cost_per_image',
    'image_analytics_enabled',
    'image_responses_image_model',
    'image_events_enabled',
    'canvas_context_enabled',
    'free_generation_enabled',
    'guest_generation_enabled',
    'available_image_models',
    'image_model_credit_costs',
    'openai_b64_json_enabled',
    'disabled_env_providers'
  )
);

insert into public.app_settings (key, value, description)
values (
  'disabled_env_providers',
  '[]'::jsonb,
  '被停用的环境变量兜底 Provider id 列表（如 env:chat:openai）；只影响该 Provider 是否参与模型选择。'
)
on conflict (key) do nothing;
