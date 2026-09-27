variable "primary_region" {
  type    = string
  default = "us-east-1"
}

variable "secondary_region" {
  type    = string
  default = "us-west-2"
}

variable "environment" {
  type    = string
  default = "staging"
}

variable "primary_db_arn" {
  description = "ARN of the primary RDS Postgres instance to replicate cross-region."
  type        = string
}

variable "db_instance_class" {
  type    = string
  default = "db.r6g.large"
}

variable "backup_bucket" {
  description = "Primary-region S3 bucket holding exports and backups."
  type        = string
}

variable "hosted_zone_id" {
  type = string
}

variable "domain" {
  description = "Public hostname served by the explorer (e.g. explorer.example.com)."
  type        = string
}

variable "primary_lb_dns" {
  type = string
}

variable "secondary_lb_dns" {
  type = string
}

variable "lb_zone_id" {
  type = string
}
