# Infrastructure and Deployment

## Infrastructure as Code

- **Tool:** Terraform 1.5.0
- **Location:** `infrastructure/terraform/`
- **Approach:** Modular Terraform with environment-specific configurations

## Deployment Strategy

- **Strategy:** Blue-Green deployment with ECS Fargate
- **CI/CD Platform:** GitHub Actions
- **Pipeline Configuration:** `.github/workflows/`

## Environments

- **Development:** Local Docker Compose environment for development and testing
- **Staging:** AWS ECS Fargate with staging configuration for pre-production testing
- **Production:** AWS ECS Fargate with production configuration for live deployment

## Environment Promotion Flow

```
Development → Staging → Production
     ↓           ↓          ↓
   Local      ECS Dev    ECS Prod
  Docker      Region     Region
 Compose
```

## Rollback Strategy

- **Primary Method:** ECS service rollback to previous task definition
- **Trigger Conditions:** Health check failures, error rate thresholds, manual intervention
- **Recovery Time Objective:** < 5 minutes for service rollback
