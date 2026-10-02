"""Create a regional credential signing secret without printing or storing its value."""
import argparse
import json
import secrets
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--region', required=True)
parser.add_argument('--environment', choices=['staging', 'production'], required=True)
args = parser.parse_args()
request = {
    'Name': f'xeom-{args.environment}-guest',
    'Description': 'Regional guest identity and matchmaking RPC signing key. Preserve for career continuity.',
    'SecretString': secrets.token_hex(32),
}
# create-secret fails if it exists: rerunning never rotates identities accidentally.
result = subprocess.run(
    ['aws', 'secretsmanager', 'create-secret', '--region', args.region,
     '--cli-input-json', 'file:///dev/stdin', '--query', 'ARN', '--output', 'text'],
    input=json.dumps(request), text=True, capture_output=True, check=True,
)
print(result.stdout.strip())
