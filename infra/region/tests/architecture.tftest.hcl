mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["ap-southeast-1a", "ap-southeast-1b"] }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
}
variables {
  region           = "ap-southeast-1"
  environment      = "staging"
  image            = "123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/game@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  release_sha      = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  hosted_zone_id   = "ZEXAMPLE"
  api_domain       = "sg.example.com"
  allowed_origins  = ["https://play.example.com"]
  guest_secret_arn = "arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:guest-abcdef"
  alarm_email      = "ops@example.com"
  regions          = [{ id = "ap-southeast-1", label = "Singapore", apiUrl = "https://sg.example.com" }]
}
run "regional_architecture" {
  command = plan
  assert {
    condition     = alltrue([for id in var.room_ids : aws_ecs_service.room[id].desired_count == 1 && aws_ecs_service.room[id].deployment_maximum_percent == 100 && aws_ecs_service.room[id].deployment_minimum_healthy_percent == 0])
    error_message = "A city must have exactly one authoritative owner, including deployments."
  }
  assert {
    condition     = aws_ecs_service.matchmaker.desired_count == 2 && aws_appautoscaling_target.matchmaker.min_capacity == 2
    error_message = "Regional matchmaking must have redundant instances."
  }
  assert {
    condition     = length(aws_lb_listener_rule.room) == length(var.room_ids) && output.human_capacity == 128
    error_message = "Every room needs its own stable routing target and bounded capacity."
  }
  assert {
    condition     = aws_lb_listener.https.port == 443 && aws_lb_listener.https.protocol == "HTTPS"
    error_message = "Public ingress must use TLS."
  }
  assert {
    condition     = aws_dynamodb_table.careers.point_in_time_recovery[0].enabled
    error_message = "Career storage needs point-in-time recovery."
  }
}
