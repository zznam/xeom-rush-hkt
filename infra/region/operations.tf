resource "aws_sns_topic" "alerts" {
  name = "${local.name}-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}
resource "aws_cloudwatch_metric_alarm" "unhealthy" {
  for_each            = local.services
  alarm_name          = "${local.name}-${each.key}-unhealthy"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 5
  threshold           = 0
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  statistic           = "Maximum"
  period              = 60
  treat_missing_data  = "breaching"
  dimensions          = { LoadBalancer = aws_lb.game.arn_suffix, TargetGroup = aws_lb_target_group.service[each.key].arn_suffix }
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
resource "aws_cloudwatch_metric_alarm" "cpu" {
  for_each            = local.rooms
  alarm_name          = "${local.name}-${each.key}-capacity"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 5
  threshold           = 70
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 60
  dimensions          = { ClusterName = aws_ecs_cluster.game.name, ServiceName = each.key }
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
resource "aws_cloudwatch_log_metric_filter" "storage_errors" {
  name           = "${local.name}-storage-errors"
  log_group_name = aws_cloudwatch_log_group.game.name
  pattern        = "\"[Storage]\" \"failed\""
  metric_transformation {
    name      = "StorageErrors"
    namespace = "XeomRush/${var.environment}"
    value     = "1"
  }
}
resource "aws_cloudwatch_metric_alarm" "storage_errors" {
  alarm_name          = "${local.name}-storage-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0
  namespace           = "XeomRush/${var.environment}"
  metric_name         = "StorageErrors"
  statistic           = "Sum"
  period              = 60
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
resource "aws_wafv2_web_acl" "api" {
  name  = "${local.name}-api"
  scope = "REGIONAL"
  default_action {
    allow {
    }
  }

  rule {
    name     = "bounded-admission"
    priority = 1
    action {
      block {
      }
    }

    statement {
      rate_based_statement {
        limit              = 500
        aggregate_key_type = "IP"
        scope_down_statement {
          byte_match_statement {
            positional_constraint = "STARTS_WITH"
            search_string         = "/api/"
            field_to_match {
              uri_path {
              }
            }

            text_transformation {
              priority = 0
              type     = "NONE"
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "admission-rate"
      sampled_requests_enabled   = false
    }
  }
  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name}-api"
    sampled_requests_enabled   = false
  }
}
resource "aws_wafv2_web_acl_association" "api" {
  resource_arn = aws_lb.game.arn
  web_acl_arn  = aws_wafv2_web_acl.api.arn
}
resource "aws_cloudwatch_metric_alarm" "occupancy" {
  for_each            = local.rooms
  alarm_name          = "${local.name}-${each.key}-seats"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 5
  threshold           = var.room_capacity * 0.8
  namespace           = "XeomRush"
  metric_name         = "OccupiedSeats"
  statistic           = "Maximum"
  period              = 60
  dimensions          = { Region = var.region, Room = each.key, Environment = var.environment }
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
resource "aws_cloudwatch_metric_alarm" "tick_budget" {
  for_each            = local.rooms
  alarm_name          = "${local.name}-${each.key}-tick-budget"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  threshold           = 40
  namespace           = "XeomRush"
  metric_name         = "TickDurationMs"
  statistic           = "Maximum"
  period              = 60
  dimensions          = { Region = var.region, Room = each.key, Environment = var.environment }
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
