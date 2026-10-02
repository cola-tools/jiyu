-- ═══════════════════════════════════════════════════════════════════════════
--  会员体系升级脚本（v1 → v2）
--  适用：数据库已经建好、且已导入过数据，不想清库重建的情况
--
--  用法：
--      mysql -u root -p linux_study < migrate_v2_member.sql
--
--  说明：
--      · 全程幂等，可重复执行
--      · 不删除任何既有数据（打卡记录、学生名单、目录树全部保留）
--      · 全新部署无需执行本脚本，直接初始化 schema.sql 即可
--
--  实现方式说明：MySQL 不支持 `ADD COLUMN IF NOT EXISTS`，
--      因此这里统一用 information_schema 判断 + PREPARE 动态执行，
--      避免依赖 DELIMITER（该指令是客户端语法，驱动多语句执行时不可用）。
-- ═══════════════════════════════════════════════════════════════════════════

USE `linux_study`;
SET NAMES utf8mb4;

-- ── 1. students 增加会员字段 ────────────────────────────────────────────────
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `students` ADD COLUMN `member_type` VARCHAR(16) NOT NULL DEFAULT ''none'' COMMENT ''none普通会员 week周 month月 year年 forever永久''',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'students' AND COLUMN_NAME = 'member_type');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `students` ADD COLUMN `member_expire_at` DATETIME NULL COMMENT ''会员到期时刻；永久会员与普通会员为 NULL''',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'students' AND COLUMN_NAME = 'member_expire_at');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `students` ADD COLUMN `member_started_at` DATETIME NULL COMMENT ''最近一次开通/续费时刻''',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'students' AND COLUMN_NAME = 'member_started_at');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ── 2. phone 改为可空（UNIQUE 索引允许多行 NULL，但不允许多行 ''） ──────────
UPDATE `students` SET `phone` = NULL WHERE `phone` = '' OR `phone` IS NULL;

SET @s := (SELECT IF(COUNT(*) > 0,
  'ALTER TABLE `students` MODIFY COLUMN `phone` VARCHAR(32) NULL DEFAULT NULL COMMENT ''手机号（账号唯一性约束）''',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'students'
    AND COLUMN_NAME = 'phone' AND IS_NULLABLE = 'NO');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ── 3. 手机号唯一索引（先清理重复号码，保留 id 最小的那条） ─────────────────
UPDATE `students` s
  JOIN (SELECT `phone`, MIN(`id`) AS keep_id FROM `students`
         WHERE `phone` IS NOT NULL GROUP BY `phone` HAVING COUNT(*) > 1) d
    ON s.`phone` = d.`phone` AND s.`id` <> d.keep_id
   SET s.`phone` = NULL;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `students` ADD UNIQUE KEY `uk_student_phone` (`phone`)',
  'DO 0')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'students' AND INDEX_NAME = 'uk_student_phone');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `students` ADD KEY `idx_student_member` (`member_type`, `member_expire_at`)',
  'DO 0')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'students' AND INDEX_NAME = 'idx_student_member');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `students` ADD KEY `idx_student_status` (`status`)',
  'DO 0')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'students' AND INDEX_NAME = 'idx_student_status');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ── 4. units 增加免费开放标识 ──────────────────────────────────────────────
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `units` ADD COLUMN `is_free` TINYINT NOT NULL DEFAULT 0 COMMENT ''是否对普通会员免费开放''',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'units' AND COLUMN_NAME = 'is_free');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ── 5. 新表（定价 / 验证码 / 会员流水 / 导出流水） ─────────────────────────
CREATE TABLE IF NOT EXISTS `pricing` (
  `code`       VARCHAR(16)  NOT NULL COMMENT 'none/week/month/year/forever',
  `label`      VARCHAR(32)  NOT NULL COMMENT '周会员 / 月会员 / 年会员 / 永久会员',
  `price`      DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '价格（元）',
  `days`       INT          NOT NULL DEFAULT 0 COMMENT '有效天数；0 表示永久',
  `perks`      VARCHAR(500) NOT NULL DEFAULT '' COMMENT '功能权益说明（｜分隔）',
  `tagline`    VARCHAR(120) NOT NULL DEFAULT '' COMMENT '副标题',
  `is_hot`     TINYINT      NOT NULL DEFAULT 0 COMMENT '是否推荐档位',
  `enabled`    TINYINT      NOT NULL DEFAULT 1 COMMENT '1上架 0下架',
  `sort_order` INT          NOT NULL DEFAULT 0,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='会员定价';

CREATE TABLE IF NOT EXISTS `sms_codes` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `phone`      VARCHAR(32)  NOT NULL,
  `code`       VARCHAR(8)   NOT NULL COMMENT '6 位数字',
  `scene`      VARCHAR(16)  NOT NULL DEFAULT 'register' COMMENT 'register|forgot',
  `expire_at`  DATETIME     NOT NULL,
  `used_at`    DATETIME     NULL,
  `send_count` INT          NOT NULL DEFAULT 1,
  `request_ip` VARCHAR(64)  NOT NULL DEFAULT '',
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sms_phone` (`phone`, `scene`, `created_at`),
  KEY `idx_sms_expire` (`expire_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='短信验证码';

CREATE TABLE IF NOT EXISTS `captcha_codes` (
  `token`      CHAR(32)     NOT NULL,
  `answer`     VARCHAR(16)  NOT NULL,
  `expire_at`  DATETIME     NOT NULL,
  `used_at`    DATETIME     NULL,
  `request_ip` VARCHAR(64)  NOT NULL DEFAULT '',
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`token`),
  KEY `idx_captcha_expire` (`expire_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='图形验证码';

CREATE TABLE IF NOT EXISTS `member_logs` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `student_id`   INT UNSIGNED NOT NULL,
  `action`       VARCHAR(16)  NOT NULL,
  `type_from`    VARCHAR(16)  NOT NULL DEFAULT '',
  `type_to`      VARCHAR(16)  NOT NULL DEFAULT '',
  `expire_from`  DATETIME     NULL,
  `expire_to`    DATETIME     NULL,
  `days_added`   INT          NOT NULL DEFAULT 0,
  `operator_type` ENUM('admin','system') NOT NULL DEFAULT 'admin',
  `operator_id`  INT UNSIGNED NULL,
  `operator_name` VARCHAR(64) NOT NULL DEFAULT '',
  `remark`       VARCHAR(255) NOT NULL DEFAULT '',
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_mlog_student` (`student_id`, `created_at`),
  KEY `idx_mlog_created` (`created_at`),
  CONSTRAINT `fk_mlog_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='会员变更流水';

CREATE TABLE IF NOT EXISTS `export_logs` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `student_id` INT UNSIGNED NOT NULL,
  `format`     VARCHAR(8)   NOT NULL COMMENT 'csv|xlsx|pdf',
  `rows`       INT          NOT NULL DEFAULT 0,
  `date_from`  DATE         NULL,
  `date_to`    DATE         NULL,
  `request_ip` VARCHAR(64)  NOT NULL DEFAULT '',
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_exp_student` (`student_id`, `created_at`),
  CONSTRAINT `fk_exp_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='打卡记录导出流水';

-- ── 6. 定价种子（已存在则只补齐缺失档位，不覆盖后台改过的价格） ────────────
INSERT INTO `pricing` (`code`,`label`,`price`,`days`,`perks`,`tagline`,`is_hot`,`enabled`,`sort_order`) VALUES
 ('none','普通会员',0.00,0,'第一章学习权限｜不可打卡｜不可学习全部章节｜无法登录打卡平台','免费体验',0,1,10),
 ('week','周会员',4.00,7,'可学习全章节内容｜可进行学习打卡｜专业团队出题练习｜可导出学习打卡记录','短期冲刺｜7 天',0,1,20),
 ('month','月会员',12.00,30,'可学习全章节内容｜可进行学习打卡｜专业团队出题练习｜可导出学习打卡记录','最受欢迎｜30 天',1,1,30),
 ('year','年会员',24.00,365,'可学习全章节内容｜可进行学习打卡｜专业团队出题练习｜可导出学习打卡记录','超高性价比｜365 天',0,1,40),
 ('forever','永久会员',59.90,0,'可学习全章节内容｜可进行学习打卡｜专业团队出题练习｜可导出学习打卡记录','一次购买｜终身可用',0,1,50)
ON DUPLICATE KEY UPDATE `label` = VALUES(`label`);

-- ── 7. 章节免费范围：仅「① 入门与安装」对普通会员开放 ─────────────────────
UPDATE `units` SET `is_free` = 0 WHERE `is_free` <> 0;
UPDATE `units` SET `is_free` = 1 WHERE `level` = 2 AND `title` LIKE '①%';

-- ── 8. 历史数据补齐：手机号为空的学生标记为普通会员 ────────────────────────
UPDATE `students` SET `member_type` = 'none' WHERE `member_type` = '' OR `member_type` IS NULL;

-- ── 完成 ───────────────────────────────────────────────────────────────────
SELECT '✔ 会员体系升级完成' AS result;
SELECT
  (SELECT COUNT(*) FROM `students` WHERE `member_type` <> 'none') AS 付费会员数,
  (SELECT COUNT(*) FROM `units` WHERE `is_free` = 1)              AS 免费章节数,
  (SELECT COUNT(*) FROM `pricing`)                                AS 定价档位数;
