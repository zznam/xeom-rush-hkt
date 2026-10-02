output "api_url" {
  value = "https://${var.api_domain}"
}

output "cluster_name" {
  value = aws_ecs_cluster.game.name
}

output "room_ids" {
  value = sort(tolist(var.room_ids))
}

output "human_capacity" {
  value = length(var.room_ids) * var.room_capacity
}

output "regions_json" {
  value = jsonencode(var.regions)
}

output "careers_table" {
  value = aws_dynamodb_table.careers.name
}
