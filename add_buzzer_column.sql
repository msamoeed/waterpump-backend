-- Migration script to add buzzer_muted column to motor_states table
-- Run this script on your PostgreSQL database

-- Add buzzer_muted column with default value false
ALTER TABLE motor_states 
ADD COLUMN buzzer_muted BOOLEAN NOT NULL DEFAULT false;

-- Update existing records to have buzzer enabled by default
UPDATE motor_states 
SET buzzer_muted = false 
WHERE buzzer_muted IS NULL;

-- Add comment to document the column
COMMENT ON COLUMN motor_states.buzzer_muted IS 'Controls whether the buzzer is muted (true) or enabled (false)';

-- Verify the column was added
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'motor_states' AND column_name = 'buzzer_muted';
