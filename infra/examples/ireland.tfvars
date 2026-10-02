region           = "eu-west-1"
environment      = "production"
hosted_zone_id   = "REPLACE_WITH_ROUTE53_ZONE_ID"
api_domain       = "eu.play.example.com"
allowed_origins  = ["https://REPLACE.cloudfront.net"]
guest_secret_arn = "arn:aws:secretsmanager:eu-west-1:REPLACE:secret:xeom-production-guest-REPLACE"
alarm_email      = "REPLACE_WITH_OPERATOR_EMAIL"
room_ids         = ["city-01", "city-02"]
room_capacity    = 64
regions = [
  { id = "ap-southeast-1", label = "Singapore", apiUrl = "https://sg.play.example.com" },
  { id = "eu-west-1", label = "Ireland", apiUrl = "https://eu.play.example.com" }
]
