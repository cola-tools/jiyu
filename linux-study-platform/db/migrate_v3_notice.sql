-- ═══════════════════════════════════════════════════════════════════════════
--  提醒功能升级脚本（v2 → v3）
--  新增：管理员「提醒学生」——群发全体学生，学生端右上角面板展示，
--        只能由学生点叉号关闭；未关闭则下次登录继续显示。
--
--  用法：
--      mysql -u root -p linux_study < migrate_v3_notice.sql
--
--  说明：
--      · 全程幂等，可重复执行
--      · 不删除任何既有数据（提醒表为纯新增）
--      · 全新部署无需执行本脚本，直接初始化 schema.sql 即可
--
--  实现方式：MySQL 不支持 `CREATE TABLE IF NOT EXISTS` 之外的条件 DDL，
--      这里用 information_schema 判断 + PREPARE 动态执行，
--      避免依赖 DELIMITER（该指令是客户端语法，驱动多语句执行时不可用）。
-- ═══════════════════════════════════════════════════════════════════════════

USE `linux_study`;
SET NAMES utf8mb4;

-- ── 1. 提醒主表 ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `notices` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id`     INT UNSIGNED NOT NULL,
  `admin_name`   VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '发送者姓名快照（管理员改名不影响历史）',
  `content`      TEXT         NOT NULL COMMENT '提醒内容',
  `priority`     TINYINT      NOT NULL DEFAULT 1 COMMENT '1普通 2重要 3紧急',
  `target_count` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '发送时覆盖的学生数（快照）',
  `revoked_at`   DATETIME     NULL COMMENT '撤回时刻；NULL＝有效提醒',
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_notice_admin` (`admin_id`),
  KEY `idx_notice_created` (`created_at`),
  CONSTRAINT `fk_notice_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员提醒';

-- ── 2. 提醒关闭记录（学生点叉号才写入；没有记录 ⇒ 每次登录都继续显示） ─────
CREATE TABLE IF NOT EXISTS `notice_dismiss` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `notice_id`    BIGINT UNSIGNED NOT NULL,
  `student_id`   INT UNSIGNED NOT NULL,
  `dismissed_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '关闭时刻',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_notice_student` (`notice_id`, `student_id`),
  KEY `idx_nd_student` (`student_id`),
  CONSTRAINT `fk_nd_notice` FOREIGN KEY (`notice_id`) REFERENCES `notices` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_nd_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='提醒关闭记录';

-- ── 3. 老库补齐：外键缺失时补上（CREATE TABLE IF NOT EXISTS 对已存在表不生效） ──
SET @s := (SELECT IF(COUNT(*) = 0 AND
    (SELECT COUNT(*) FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notices') > 0,
  'ALTER TABLE `notices` ADD CONSTRAINT `fk_notice_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins` (`id`) ON DELETE CASCADE',
  'DO 0')
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notices'
    AND CONSTRAINT_NAME = 'fk_notice_admin' AND CONSTRAINT_TYPE = 'FOREIGN KEY');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0 AND
    (SELECT COUNT(*) FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notice_dismiss') > 0,
  'ALTER TABLE `notice_dismiss` ADD CONSTRAINT `fk_nd_notice` FOREIGN KEY (`notice_id`) REFERENCES `notices` (`id`) ON DELETE CASCADE',
  'DO 0')
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notice_dismiss'
    AND CONSTRAINT_NAME = 'fk_nd_notice' AND CONSTRAINT_TYPE = 'FOREIGN KEY');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0 AND
    (SELECT COUNT(*) FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notice_dismiss') > 0,
  'ALTER TABLE `notice_dismiss` ADD CONSTRAINT `fk_nd_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE',
  'DO 0')
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notice_dismiss'
    AND CONSTRAINT_NAME = 'fk_nd_student' AND CONSTRAINT_TYPE = 'FOREIGN KEY');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ── 4. 老库补齐：唯一键（防止同一学生重复关闭记录） ───────────────────────
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `notice_dismiss` ADD UNIQUE KEY `uk_notice_student` (`notice_id`, `student_id`)',
  'DO 0')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notice_dismiss'
    AND INDEX_NAME = 'uk_notice_student');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ── 完成 ───────────────────────────────────────────────────────────────────
SELECT '✔ 提醒功能升级完成' AS result;
SELECT
  (SELECT COUNT(*) FROM `notices` WHERE `revoked_at` IS NULL) AS 有效提醒数,
  (SELECT COUNT(*) FROM `students` WHERE `status` = 1)        AS 可接收学生数;
