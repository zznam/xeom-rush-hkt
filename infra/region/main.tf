locals {
  name     = "xeom-${var.environment}"
  rooms    = { for id in var.room_ids : id => { role = "game" } }
  services = merge(local.rooms, { matchmaker = { role = "matchmaker" } })
  common_environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "DEPLOY_TARGET", value = "regional-production" },
    { name = "PORT", value = "3002" },
    { name = "GAME_REGION", value = var.region },
    { name = "ALLOWED_ORIGINS", value = join(",", var.allowed_origins) },
    { name = "RELEASE_SHA", value = var.release_sha },
    { name = "DEPLOY_ENVIRONMENT", value = var.environment }
  ]
}
data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {
}

resource "aws_vpc" "game" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true
}
resource "aws_internet_gateway" "game" {
  vpc_id = aws_vpc.game.id
}

resource "aws_subnet" "public" {
  count             = 2
  vpc_id            = aws_vpc.game.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone = data.aws_availability_zones.available.names[count.index]
}
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.game.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.game.id
  }
}
resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}
resource "aws_vpc_endpoint" "dynamo" {
  vpc_id            = aws_vpc.game.id
  service_name      = "com.amazonaws.${var.region}.dynamodb"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.public.id]
}
resource "aws_security_group" "alb" {
  name_prefix = "${local.name}-alb-"
  vpc_id      = aws_vpc.game.id
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 3002
    to_port     = 3002
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
}
resource "aws_security_group" "tasks" {
  name_prefix = "${local.name}-tasks-"
  vpc_id      = aws_vpc.game.id
  ingress {
    from_port       = 3002
    to_port         = 3002
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
resource "aws_acm_certificate" "api" {
  domain_name       = var.api_domain
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}
resource "aws_route53_record" "validation" {
  for_each = toset([var.api_domain])
  zone_id  = var.hosted_zone_id
  name     = one(aws_acm_certificate.api.domain_validation_options).resource_record_name
  type     = one(aws_acm_certificate.api.domain_validation_options).resource_record_type
  records  = [one(aws_acm_certificate.api.domain_validation_options).resource_record_value]
  ttl      = 60
}
resource "aws_acm_certificate_validation" "api" {
  certificate_arn         = aws_acm_certificate.api.arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]
}
resource "aws_lb" "game" {
  name                       = local.name
  load_balancer_type         = "application"
  subnets                    = aws_subnet.public[*].id
  security_groups            = [aws_security_group.alb.id]
  idle_timeout               = 120
  drop_invalid_header_fields = true
  enable_deletion_protection = var.environment == "production"
}
resource "aws_route53_record" "api" {
  zone_id = var.hosted_zone_id
  name    = var.api_domain
  type    = "A"
  alias {
    name                   = aws_lb.game.dns_name
    zone_id                = aws_lb.game.zone_id
    evaluate_target_health = true
  }
}
resource "aws_lb_target_group" "service" {
  for_each             = local.services
  name_prefix          = "xeom-"
  port                 = 3002
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.game.id
  deregistration_delay = 30
  health_check {
    path                = "/api/ready"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }
  lifecycle {
    create_before_destroy = true
  }
}
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.game.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.api.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.service["matchmaker"].arn
  }
}
resource "aws_lb_listener_rule" "room" {
  for_each     = local.rooms
  listener_arn = aws_lb_listener.https.arn
  priority     = 100 + index(sort(tolist(var.room_ids)), each.key)
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.service[each.key].arn
  }
  condition {
    path_pattern {
      values = ["/rooms/${each.key}", "/rooms/${each.key}/*"]
    }
  }
}
resource "aws_dynamodb_table" "careers" {
  name                        = "${local.name}-careers"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "pk"
  deletion_protection_enabled = var.environment == "production"
  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "board"
    type = "S"
  }
  attribute {
    name = "careerScore"
    type = "N"
  }
  global_secondary_index {
    name = "leaderboard"
    key_schema {
      attribute_name = "board"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "careerScore"
      key_type       = "RANGE"
    }
    projection_type = "ALL"
  }
  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }
}
resource "aws_cloudwatch_log_group" "game" {
  name              = "/ecs/${local.name}"
  retention_in_days = 30
}
resource "aws_ecs_cluster" "game" {
  name = local.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}
resource "aws_iam_role" "execution" {
  name               = "${local.name}-${var.region}-execution"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}
resource "aws_iam_role_policy" "secret" {
  role   = aws_iam_role.execution.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = var.guest_secret_arn }] })
}
resource "aws_iam_role" "game" {
  name               = "${local.name}-${var.region}-game"
  assume_role_policy = aws_iam_role.execution.assume_role_policy
}
resource "aws_iam_role_policy" "storage" {
  role   = aws_iam_role.game.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"], Resource = [aws_dynamodb_table.careers.arn, "${aws_dynamodb_table.careers.arn}/index/leaderboard"] }] })
}
resource "aws_iam_role" "matchmaker" {
  name               = "${local.name}-${var.region}-matchmaker"
  assume_role_policy = aws_iam_role.execution.assume_role_policy
}
resource "aws_ecs_task_definition" "service" {
  for_each                 = local.services
  family                   = "${local.name}-${each.key}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = each.value.role == "game" ? 1024 : 512
  memory                   = each.value.role == "game" ? 2048 : 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = each.value.role == "game" ? aws_iam_role.game.arn : aws_iam_role.matchmaker.arn
  container_definitions = jsonencode([{
    name            = "app", image = var.image, essential = true,
    command         = ["node", each.value.role == "game" ? "apps/server/dist/index.js" : "apps/server/dist/matchmaking.js"],
    user            = "1000", readonlyRootFilesystem = true, stopTimeout = 30,
    linuxParameters = { initProcessEnabled = true },
    portMappings    = [{ containerPort = 3002, protocol = "tcp" }],
    environment = concat(local.common_environment, each.value.role == "game" ? [
      { name = "ROOM_ID", value = each.key }, { name = "ROOM_CAPACITY", value = tostring(var.room_capacity) },
      { name = "DYNAMODB_TABLE", value = aws_dynamodb_table.careers.name },
      { name = "PRIVATE_ROOMS_ENABLED", value = tostring(var.private_rooms_enabled) },
      { name = "MAX_PRIVATE_ROOMS", value = tostring(var.max_private_rooms) }
      ] : [
      { name = "ROOM_IDS", value = join(",", sort(tolist(var.room_ids))) },
      { name = "REGIONS_JSON", value = jsonencode(var.regions) }
    ]),
    secrets = [{ name = "GUEST_SECRET", valueFrom = var.guest_secret_arn }],
    healthCheck = {
      command  = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:3002/api/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""],
      interval = 30, timeout = 5, retries = 3, startPeriod = 30
    },
    logConfiguration = { logDriver = "awslogs", options = { awslogs-group = aws_cloudwatch_log_group.game.name, awslogs-region = var.region, awslogs-stream-prefix = each.key } }
  }])
  lifecycle {
    precondition {
      condition     = length([for r in var.regions : r if r.id == var.region && r.apiUrl == "https://${var.api_domain}"]) == 1
      error_message = "Region directory must contain this AWS region and its exact HTTPS API origin."
    }
  }
}
resource "aws_ecs_service" "room" {
  for_each                           = local.rooms
  name                               = each.key
  cluster                            = aws_ecs_cluster.game.id
  task_definition                    = aws_ecs_task_definition.service[each.key].arn
  desired_count                      = 1
  launch_type                        = "FARGATE"
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  health_check_grace_period_seconds  = 60
  wait_for_steady_state              = true
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.service[each.key].arn
    container_name   = "app"
    container_port   = 3002
  }
  # A city has one authoritative owner. Never autoscale its task count.

  depends_on = [aws_lb_listener_rule.room, aws_lb_listener.https, aws_iam_role_policy.storage, aws_iam_role_policy.secret, aws_iam_role_policy_attachment.execution]
}
resource "aws_ecs_service" "matchmaker" {
  name                               = "matchmaker"
  cluster                            = aws_ecs_cluster.game.id
  task_definition                    = aws_ecs_task_definition.service["matchmaker"].arn
  desired_count                      = 2
  launch_type                        = "FARGATE"
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60
  wait_for_steady_state              = true
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.service["matchmaker"].arn
    container_name   = "app"
    container_port   = 3002
  }
  # Matchmaker task counts are managed by application autoscaling.
  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [aws_lb_listener_rule.room, aws_lb_listener.https, aws_iam_role_policy.storage, aws_iam_role_policy.secret, aws_iam_role_policy_attachment.execution]
}
resource "aws_appautoscaling_target" "matchmaker" {
  max_capacity       = 6
  min_capacity       = 2
  resource_id        = "service/${aws_ecs_cluster.game.name}/${aws_ecs_service.matchmaker.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}
resource "aws_appautoscaling_policy" "matchmaker" {
  name               = "${local.name}-matchmaker-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.matchmaker.resource_id
  scalable_dimension = aws_appautoscaling_target.matchmaker.scalable_dimension
  service_namespace  = aws_appautoscaling_target.matchmaker.service_namespace
  target_tracking_scaling_policy_configuration {
    target_value = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }

    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
