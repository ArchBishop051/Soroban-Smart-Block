# Multi-region disaster recovery (#940): cross-region async Postgres replica,
# S3 replication for exports/backups, a mirrored image registry, and DNS
# failover records. Target RPO < 1 min, RTO < 15 min — see
# docs/guides/disaster-recovery.md.

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.primary_region
}

provider "aws" {
  alias  = "secondary"
  region = var.secondary_region
}

locals {
  name = "soroban-explorer-${var.environment}"
}

# ── Postgres: async cross-region read replica (promoted on failover) ─────────
resource "aws_db_instance" "replica" {
  provider               = aws.secondary
  identifier             = "${local.name}-dr"
  replicate_source_db    = var.primary_db_arn
  instance_class         = var.db_instance_class
  storage_encrypted      = true
  kms_key_id             = aws_kms_key.dr.arn
  backup_retention_period = 7
  skip_final_snapshot    = false
  final_snapshot_identifier = "${local.name}-dr-final"
  tags = { Role = "dr-replica" }
}

resource "aws_kms_key" "dr" {
  provider            = aws.secondary
  description         = "${local.name} DR encryption key"
  enable_key_rotation = true
}

# ── Object storage replication for exports/backups ───────────────────────────
resource "aws_s3_bucket" "dr" {
  provider = aws.secondary
  bucket   = "${var.backup_bucket}-dr"
}

resource "aws_s3_bucket_versioning" "dr" {
  provider = aws.secondary
  bucket   = aws_s3_bucket.dr.id
  versioning_configuration { status = "Enabled" }
}

data "aws_iam_policy_document" "replication_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "replication" {
  name               = "${local.name}-s3-replication"
  assume_role_policy = data.aws_iam_policy_document.replication_assume.json
}

data "aws_iam_policy_document" "replication" {
  statement {
    actions   = ["s3:GetReplicationConfiguration", "s3:ListBucket"]
    resources = ["arn:aws:s3:::${var.backup_bucket}"]
  }
  statement {
    actions   = ["s3:GetObjectVersionForReplication", "s3:GetObjectVersionAcl", "s3:GetObjectVersionTagging"]
    resources = ["arn:aws:s3:::${var.backup_bucket}/*"]
  }
  statement {
    actions   = ["s3:ReplicateObject", "s3:ReplicateDelete", "s3:ReplicateTags"]
    resources = ["${aws_s3_bucket.dr.arn}/*"]
  }
}

resource "aws_iam_role_policy" "replication" {
  role   = aws_iam_role.replication.id
  policy = data.aws_iam_policy_document.replication.json
}

resource "aws_s3_bucket_replication_configuration" "backups" {
  role   = aws_iam_role.replication.arn
  bucket = var.backup_bucket
  rule {
    id     = "dr"
    status = "Enabled"
    filter {}
    delete_marker_replication { status = "Enabled" }
    destination {
      bucket        = aws_s3_bucket.dr.arn
      storage_class = "STANDARD_IA"
      replication_time {
        status = "Enabled"
        time { minutes = 15 }
      }
      metrics {
        status = "Enabled"
        event_threshold { minutes = 15 }
      }
    }
  }
  depends_on = [aws_s3_bucket_versioning.dr]
}

# ── Mirrored image registry (images are copied here by deploy.yml) ───────────
resource "aws_ecr_repository" "mirror" {
  for_each             = toset(["indexer", "frontend"])
  provider             = aws.secondary
  name                 = "soroban-explorer/${each.key}"
  image_tag_mutability = "IMMUTABLE"
}

# ── DNS failover: primary with health check, secondary as standby ───────────
resource "aws_route53_health_check" "primary" {
  fqdn              = var.primary_lb_dns
  type              = "HTTPS"
  resource_path     = "/api/health"
  failure_threshold = 3
  request_interval  = 10
}

resource "aws_route53_record" "primary" {
  zone_id         = var.hosted_zone_id
  name            = var.domain
  type            = "A"
  set_identifier  = "primary"
  health_check_id = aws_route53_health_check.primary.id
  failover_routing_policy { type = "PRIMARY" }
  alias {
    name                   = var.primary_lb_dns
    zone_id                = var.lb_zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "secondary" {
  zone_id        = var.hosted_zone_id
  name           = var.domain
  type           = "A"
  set_identifier = "secondary"
  failover_routing_policy { type = "SECONDARY" }
  alias {
    name                   = var.secondary_lb_dns
    zone_id                = var.lb_zone_id
    evaluate_target_health = true
  }
}

output "replica_identifier" {
  value = aws_db_instance.replica.identifier
}

output "dr_bucket" {
  value = aws_s3_bucket.dr.bucket
}

output "mirror_repositories" {
  value = { for k, r in aws_ecr_repository.mirror : k => r.repository_url }
}
