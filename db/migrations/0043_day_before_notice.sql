-- 전날 안내는 현재 가게 시각과 픽업 날짜를 대조하고 확정 주문만 선점한다.
CREATE INDEX orders_day_before_idx ON orders (confirmed_at) WHERE status = 'confirmed' AND personal_data_purged_at IS NULL;
