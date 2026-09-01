-- AlterTable
ALTER TABLE `bookings` MODIFY `status` ENUM('pending', 'confirmed', 'checked_in', 'cancelled', 'completed', 'no_show', 'waitlisted') NOT NULL DEFAULT 'pending';

-- AlterTable
ALTER TABLE `customers` ADD COLUMN `password_changed_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `notifications` MODIFY `status` ENUM('pending', 'sent', 'failed', 'blocked') NOT NULL DEFAULT 'pending';

-- AlterTable
ALTER TABLE `organizations` ADD COLUMN `description` VARCHAR(500) NULL,
    ADD COLUMN `facebook` VARCHAR(255) NULL,
    ADD COLUMN `instagram` VARCHAR(255) NULL,
    ADD COLUMN `opening_hours` VARCHAR(500) NULL,
    ADD COLUMN `website` VARCHAR(255) NULL,
    ADD COLUMN `whatsapp` VARCHAR(30) NULL;

-- AlterTable
ALTER TABLE `queue_tickets` ADD COLUMN `handled_by_user_id` BIGINT NULL;

-- AlterTable
ALTER TABLE `services` ADD COLUMN `capacity_per_slot` INTEGER NULL,
    ADD COLUMN `when_full` ENUM('waitlist', 'reject') NOT NULL DEFAULT 'waitlist';

-- AlterTable
ALTER TABLE `users` ADD COLUMN `email_verified` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `password_changed_at` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `auth_tokens` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `token_hash` VARCHAR(64) NOT NULL,
    `type` ENUM('password_reset', 'email_verification') NOT NULL,
    `owner_type` ENUM('user', 'customer') NOT NULL,
    `owner_id` BIGINT NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `auth_tokens_token_hash_key`(`token_hash`),
    INDEX `auth_tokens_owner_type_owner_id_type_idx`(`owner_type`, `owner_id`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `organization_requests` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `business_name` VARCHAR(150) NOT NULL,
    `owner_name` VARCHAR(150) NOT NULL,
    `business_type` VARCHAR(100) NOT NULL,
    `phone` VARCHAR(30) NOT NULL,
    `email` VARCHAR(150) NOT NULL,
    `address` VARCHAR(255) NULL,
    `city` VARCHAR(100) NULL,
    `region` VARCHAR(100) NULL,
    `number_of_branches` INTEGER NULL,
    `additional_notes` VARCHAR(1000) NULL,
    `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    `review_notes` VARCHAR(500) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `reviewed_by` BIGINT NULL,
    `created_organization_id` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `organization_requests_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contact_submissions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(150) NOT NULL,
    `email` VARCHAR(150) NOT NULL,
    `phone` VARCHAR(30) NULL,
    `subject` VARCHAR(200) NULL,
    `message` VARCHAR(2000) NOT NULL,
    `is_read` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `contact_submissions_is_read_idx`(`is_read`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `support_tickets` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `subject` VARCHAR(200) NOT NULL,
    `status` ENUM('open', 'in_progress', 'resolved') NOT NULL DEFAULT 'open',
    `from_type` ENUM('customer', 'staff', 'org_admin', 'super_admin') NOT NULL,
    `from_id` BIGINT NOT NULL,
    `to_type` ENUM('org_admin', 'super_admin') NOT NULL,
    `organization_id` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `support_tickets_to_type_organization_id_status_idx`(`to_type`, `organization_id`, `status`),
    INDEX `support_tickets_from_type_from_id_idx`(`from_type`, `from_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `support_messages` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `ticket_id` BIGINT NOT NULL,
    `sender_type` ENUM('customer', 'staff', 'org_admin', 'super_admin') NOT NULL,
    `sender_id` BIGINT NOT NULL,
    `sender_name` VARCHAR(150) NOT NULL,
    `message` VARCHAR(2000) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `support_messages_ticket_id_created_at_idx`(`ticket_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `bookings_service_id_booking_date_booking_time_status_idx` ON `bookings`(`service_id`, `booking_date`, `booking_time`, `status`);

-- AddForeignKey
ALTER TABLE `queue_tickets` ADD CONSTRAINT `queue_tickets_handled_by_user_id_fkey` FOREIGN KEY (`handled_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `organization_requests` ADD CONSTRAINT `organization_requests_created_organization_id_fkey` FOREIGN KEY (`created_organization_id`) REFERENCES `organizations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `organization_requests` ADD CONSTRAINT `organization_requests_reviewed_by_fkey` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_tickets` ADD CONSTRAINT `support_tickets_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_messages` ADD CONSTRAINT `support_messages_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

