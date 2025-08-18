# Phase 2 Human Tasks Checklist

**Epic 2: Slack Integration & HITL Framework**
_Human tasks required for Phase 2 completion_

---

## 🎯 **Overview**

This document outlines all human/manual tasks that must be completed alongside the development work for Phase 2 (Epic 2) to be fully operational. These tasks are organized by story dependency and priority.

**Phase 2 Stories:**

- Story 2.1: Slack App Configuration and Installation
- Story 2.2: Slack Command Implementation
- Story 2.3: Approval Card System
- Story 2.4: Policy Engine Implementation
- Story 2.5: Channel Management and Threading

---

## 📋 **Task Categories**

### **Priority 1: Blocking Tasks** (Must complete before development)

### **Priority 2: Parallel Tasks** (Can complete during development)

### **Priority 3: Post-Development** (Complete after development, before deployment)

---

## 🔧 **1. Slack App Setup & Configuration**

_Prerequisites for Story 2.1_

### **Priority 1: Blocking Tasks**

- [x] **1.1 Create Slack App in Target Workspace**
  - [x] Navigate to https://api.slack.com/apps
  - [x] Click "Create New App" → "From scratch"
  - [x] App Name: "MyloWare"
  - [x] Select target Slack workspace
  - [x] Record App ID for documentation

- [x] **1.2 Configure OAuth Scopes (Bot Token)**
  - [x] Navigate to "OAuth & Permissions" in app settings
  - [x] Add Bot Token Scopes:
    - [x] `chat:write` - Send messages to channels and users
    - [x] `chat:write.customize` - Customize message appearance
    - [x] `commands` - Add and use slash commands
    - [x] `reactions:write` - Add reactions to messages
    - [x] `users:read` - Read user information
  - [x] Optional scopes for future features:
    - [x] `chat:write.public` - Send messages to public channels bot isn't in
    - [x] `channels:read` - Read public channel information

- [x] **1.3 Enable Socket Mode**
  - [x] Navigate to "Socket Mode" in app settings
  - [x] Toggle "Enable Socket Mode" to ON
  - [x] Generate App-Level Token:
    - [x] Token Name: "MyloWare Socket Connection"
    - [x] Scopes: `connections:write`
    - [x] Record token (starts with `xapp-`)

- [x] **1.4 Install App to Workspace**
  - [x] Navigate to "Install App" in app settings
  - [x] Click "Install to Workspace"
  - [x] Authorize the app with required permissions
  - [x] Record Bot User OAuth Token (starts with `xoxb-`)

- [x] **1.5 Generate Signing Secret**
  - [x] Navigate to "Basic Information" in app settings
  - [x] Copy "Signing Secret" from App Credentials section
  - [x] Record signing secret for environment configuration

### **Priority 2: Parallel Tasks**

- [x] **1.6 Create Required Slack Channels**
  - [x] Create `#mylo-control` channel
    - [x] Purpose: "General commands and bot interaction"
    - [x] Set channel to Public
  - [x] Create `#mylo-approvals` channel
    - [x] Purpose: "Human-in-the-loop approval decisions"
    - [x] Set channel to Public or Private (based on security requirements)
  - [x] Create `#mylo-feed` channel
    - [x] Purpose: "Workflow run updates and progress tracking"
    - [x] Set channel to Public

- [x] **1.7 Invite Bot to Channels**
  - [x] Invite @MyloWare bot to `#mylo-control`
  - [x] Invite @MyloWare bot to `#mylo-approvals`
  - [x] Invite @MyloWare bot to `#mylo-feed`
  - [x] Verify bot appears in channel member list

---

## 🔐 **2. Environment & Infrastructure Setup**

_Cross-cutting requirements for all stories_

### **Priority 1: Blocking Tasks**

- [x] **2.1 Configure Environment Variables**
  - [x] Update `.env` file with Slack credentials:
    ```bash
    SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
    SLACK_SIGNING_SECRET=your-slack-signing-secret
    SLACK_APP_TOKEN=xapp-your-slack-app-token
    ```
  - [x] Verify all other required environment variables are set
  - [x] Test environment loading with `npm run dev`
  - [x] **FIXED**: Updated docker-compose.yml to use correct Temporal UI image (`temporalio/ui:2.21.3`)

- [x] **2.2 Secrets Management Setup**
  - [x] **Development Environment:**
    - [x] Store secrets in local `.env` file (not committed to git)
    - [x] Verify `.env` is in `.gitignore`
  - [dealy until prod] **Production Environment:**
    - [ ] Configure secrets in deployment platform (AWS Secrets Manager, etc.)
    - [ ] Document secret rotation procedures
    - [ ] Set up monitoring for secret expiration

### **Priority 2: Parallel Tasks**

- [x] **2.3 Infrastructure Services Setup**
  - [x] Start core infrastructure services:
    ```bash
    docker-compose up -d postgres redis temporal temporal-web
    ```
  - [x] Verify services are healthy:
    - [x] PostgreSQL (port 5432) - Healthy ✅
    - [x] Redis (port 6379) - Healthy ✅
    - [x] Temporal (port 7233) - Healthy ✅
    - [x] Temporal Web UI (port 8080) - Running ✅
  - [ ] **NOTE**: Application services require Dockerfiles (will be created during development)

- [ ] **2.4 Service Discovery Configuration**
  - [ ] Verify service URLs in environment:
    ```bash
    WORKFLOW_SERVICE_URL=http://localhost:3001
    POLICY_SERVICE_URL=http://localhost:3005
    NOTIFY_SERVICE_URL=http://localhost:3004
    ```
  - [ ] Test service connectivity between components (after development)
  - [ ] Configure load balancing if applicable

---

## 📏 **3. Policy Configuration & Rules**

_Prerequisites for Story 2.4_

### **Priority 1: Blocking Tasks**

- [ ] **3.1 Define Initial Policy Rules**
  - [ ] **High-Value Transaction Policy:**
    - [ ] Define transaction amount threshold (e.g., $10,000)
    - [ ] Identify required approvers (manager, finance lead)
    - [ ] Set timeout period (default: 24 hours)
  - [ ] **Sensitive Data Access Policy:**
    - [ ] Define data classification levels (PUBLIC, INTERNAL, SENSITIVE, CRITICAL)
    - [ ] Map user capabilities to data access levels
    - [ ] Define escalation procedures

- [ ] **3.2 User Capability Mapping**
  - [ ] Create user capability matrix:
    - [ ] Map Slack user IDs to system capabilities
    - [ ] Define approval authority levels
    - [ ] Document capability inheritance rules
  - [ ] Example mapping:
    ```json
    {
      "U12345678": ["financial_approval", "data_access_sensitive"],
      "U87654321": ["security_approval", "admin_override"]
    }
    ```

### **Priority 2: Parallel Tasks**

- [ ] **3.3 Policy Testing & Validation**
  - [ ] Prepare test scenarios for each policy type
  - [ ] Document expected outcomes for policy evaluation
  - [ ] Create test data for policy dry-run validation
  - [ ] Define policy rollback procedures

---

## 👥 **4. Channel Management & Permissions**

_Prerequisites for Story 2.5_

### **Priority 2: Parallel Tasks**

- [ ] **4.1 Channel Permission Audit**
  - [ ] Verify bot has required permissions in each channel:
    - [ ] `#mylo-control`: Write messages, read history, add reactions
    - [ ] `#mylo-approvals`: Write messages, read history, add reactions, manage threads
    - [ ] `#mylo-feed`: Write messages, read history, add reactions, manage threads
  - [ ] Document any permission limitations or restrictions

- [ ] **4.2 Channel Moderation Setup**
  - [ ] Define channel moderation policies
  - [ ] Set up automated cleanup rules (if available)
  - [ ] Configure channel archival procedures
  - [ ] Document manual cleanup processes

### **Priority 3: Post-Development**

- [ ] **4.3 Thread Management Configuration**
  - [ ] Define thread retention policies:
    - [ ] `#mylo-feed`: Archive threads 7 days after run completion
    - [ ] `#mylo-approvals`: Archive threads 30 days after decision
    - [ ] `#mylo-control`: Manual cleanup only
  - [ ] Set up monitoring for thread cleanup processes

---

## 🧪 **5. Testing & Validation Preparation**

_Cross-cutting for all stories_

### **Priority 2: Parallel Tasks**

- [ ] **5.1 Test Workspace Setup**
  - [ ] Create dedicated test Slack workspace (optional)
  - [ ] OR: Set up test channels in development workspace:
    - [ ] `#mylo-test-control`
    - [ ] `#mylo-test-approvals`
    - [ ] `#mylo-test-feed`
  - [ ] Configure test bot app with same permissions

- [ ] **5.2 Test User Accounts**
  - [ ] Create test user accounts for approval testing
  - [ ] Assign different capability levels to test users
  - [ ] Document test user credentials and roles

### **Priority 3: Post-Development**

- [ ] **5.3 Integration Testing Preparation**
  - [ ] Prepare test scenarios for each story:
    - [ ] Slack app installation and smoke test
    - [ ] Slash command functionality
    - [ ] Approval card interactions
    - [ ] Policy evaluation workflows
    - [ ] Channel threading and cleanup
  - [ ] Document expected behaviors and success criteria

---

## 📚 **6. Documentation & Training**

_Post-development activities_

### **Priority 3: Post-Development**

- [ ] **6.1 User Documentation**
  - [ ] Create Slack app installation guide
  - [ ] Document slash command usage
  - [ ] Create approval workflow guide for approvers
  - [ ] Document troubleshooting procedures

- [ ] **6.2 Administrator Documentation**
  - [ ] Document policy configuration procedures
  - [ ] Create channel management guide
  - [ ] Document monitoring and maintenance procedures
  - [ ] Create incident response playbook

- [ ] **6.3 Training Materials**
  - [ ] Create user training presentation
  - [ ] Prepare demo scenarios for stakeholders
  - [ ] Document best practices and usage guidelines
  - [ ] Schedule training sessions with key users

---

## 🚀 **7. Deployment & Go-Live**

_Final steps for Phase 2 completion_

### **Priority 3: Post-Development**

- [ ] **7.1 Pre-Deployment Checklist**
  - [ ] Verify all environment variables configured
  - [ ] Test Slack app connectivity
  - [ ] Validate policy configurations
  - [ ] Confirm channel setup and permissions
  - [ ] Run smoke tests in staging environment

- [ ] **7.2 Go-Live Activities**
  - [ ] Deploy services to production environment
  - [ ] Run post-deployment smoke tests
  - [ ] Announce Phase 2 availability to users
  - [ ] Monitor initial usage and performance
  - [ ] Address any immediate issues or feedback

- [ ] **7.3 Post-Go-Live Monitoring**
  - [ ] Monitor Slack app performance and usage
  - [ ] Track approval workflow metrics
  - [ ] Review policy evaluation effectiveness
  - [ ] Collect user feedback and iterate

---

## ⚠️ **Critical Dependencies & Blockers**

### **Development Blockers** (Must complete before dev work starts)

1. Slack app creation and OAuth configuration (Tasks 1.1-1.5)
2. Environment variable setup (Task 2.1)
3. Initial policy rule definition (Task 3.1)

### **Testing Blockers** (Must complete before testing)

1. Channel creation and bot invitation (Tasks 1.6-1.7)
2. User capability mapping (Task 3.2)
3. Test environment setup (Task 5.1)

### **Deployment Blockers** (Must complete before production)

1. Production secrets management (Task 2.2)
2. Policy testing and validation (Task 3.3)
3. Documentation completion (Tasks 6.1-6.2)

---

## 📊 **Success Metrics**

### **Completion Criteria**

- [ ] All Priority 1 tasks completed before development starts
- [ ] All Priority 2 tasks completed during development phase
- [ ] All Priority 3 tasks completed before production deployment

### **Validation Tests**

- [ ] Slack app smoke test passes: `POST /notifications/slack/test`
- [ ] All slash commands respond correctly
- [ ] Approval cards display and function properly
- [ ] Policy evaluation returns expected results
- [ ] Channel threading works as designed

### **Operational Readiness**

- [ ] User documentation available and reviewed
- [ ] Administrator procedures documented and tested
- [ ] Monitoring and alerting configured
- [ ] Incident response procedures defined

---

## 📝 **Notes & Assumptions**

1. **Slack Workspace Access**: Assumes admin access to target Slack workspace for app installation
2. **Security Requirements**: Policy and channel configurations may need security review
3. **User Training**: Assumes availability of key users for training and feedback
4. **Monitoring**: Assumes existing monitoring infrastructure can be extended for Slack integration

---

---

## 📊 **Current Status Summary**

### ✅ **Completed Tasks (Ready for Development)**

- **Slack App Setup**: Fully configured with OAuth scopes, Socket Mode, and channels
- **Environment Configuration**: All Slack credentials and environment variables set
- **Infrastructure Services**: PostgreSQL, Redis, Temporal, and Temporal Web UI running
- **Docker Configuration**: Fixed Temporal UI image issue

### ⏳ **Pending Tasks**

- **Policy Configuration**: Initial policy rules and user capability mapping
- **Application Services**: Will be built during development phase
- **Testing Setup**: Test workspace and user accounts
- **Documentation**: User guides and training materials

### 🚦 **Development Readiness Status**

**Status: READY FOR DEVELOPMENT** ✅

All **Priority 1 (Blocking)** tasks are complete. Development can begin on Epic 2 stories.

---

**Document Version:** 1.1  
**Created:** 2024-12-19  
**Updated:** 2024-12-19  
**Owner:** Product Owner (Sarah)  
**Status:** Infrastructure Ready - Development Can Proceed
