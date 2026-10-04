-- Admin commands are authorized by the signed-in account, never by a shared browser-stored password.
ALTER TABLE users ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
