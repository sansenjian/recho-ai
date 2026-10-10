-- 弃用 image_responses_model（"响应模型"）。
--
-- 这个键从早期的 Responses 文本/图片分离方案里留下，全仓已经没有任何代码读它去
-- 决定用哪个模型：后端只在校验时非空检查并原样存回，前端只是把它渲染成一个输入框。
-- 真正决定默认选中模型的是 image_responses_image_model（见 app-settings 的
-- resolveDefaultImageModel）。留着一个配了不生效的输入框，比没有更容易误导管理员。
--
-- 顺序很重要：先删数据行，再收窄白名单。
-- app_settings_key_check 是写入白名单，键一旦从里面移除，库里残留的该行就再也
-- 无法被 upsert 或 delete（约束会拒绝这次写入本身），只能靠更宽的约束来救。
-- 所以必须先清数据、后收窄，而不是反过来。
--
-- 已应用过的历史迁移不改动：它们记录的是当时的状态，回放时仍会创建包含该键的
-- 约束，再由本迁移收窄。

delete from public.app_settings where key = 'image_responses_model';

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
    'openai_b64_json_enabled'
  )
);
