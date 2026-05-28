# CarbonLedger Documentation

Welcome to the CarbonLedger documentation! This directory contains all guides, references, and resources for contributors and users.

## 📚 Documentation Index

### 🚀 Getting Started

Perfect for new contributors:

| Document | Description | Time |
|----------|-------------|------|
| **[New Contributor Guide](NEW_CONTRIBUTOR_GUIDE.md)** | Complete overview for first-time contributors | 5 min read |
| **[Quick Start Guide](QUICK_START.md)** | Fastest path from zero to running tests | 15-25 min |
| **[Setup Checklist](SETUP_CHECKLIST.md)** | Step-by-step verification checklist | 10 min |

### 📖 Detailed Guides

In-depth documentation:

| Document | Description | Audience |
|----------|-------------|----------|
| **[Contributing Guide](../CONTRIBUTING.md)** | Complete setup, workflow, and guidelines | All contributors |
| **[Troubleshooting Guide](TROUBLESHOOTING.md)** | Solutions to common issues | Everyone |
| **[Testnet Guide](TESTNET_GUIDE.md)** | Stellar testnet setup and usage | Developers |

### 🏗️ Architecture

Understanding the system:

| Document | Description | Audience |
|----------|-------------|----------|
| **[Architecture Decision Records](adr/)** | Why we made key technical decisions | Developers |
| **[Deployment Guide](deployment.md)** | Production deployment instructions | DevOps |
| **[TTL Cost Analysis](ttl-cost.md)** | Soroban storage cost analysis | Developers |
| **[Verifier Onboarding](verifier-onboarding.md)** | Guide for carbon verifiers | Verifiers |

### 🌿 Carbon Domain References

| Document | Description | Audience |
|----------|-------------|----------|
| **[Carbon Methodology Reference](CARBON_METHODOLOGY_REFERENCE.md)** | Supported methodologies, scoring rubric, and contract parameter mapping | All contributors |

### 🔌 API Documentation

Technical references:

| Document | Description | Audience |
|----------|-------------|----------|
| **[Projects API](../backend/docs/PROJECTS_API.md)** | Backend API endpoints | Frontend devs |

---

## 🎯 Quick Navigation

### I want to...

#### Start Contributing
1. Read [New Contributor Guide](NEW_CONTRIBUTOR_GUIDE.md)
2. Follow [Quick Start Guide](QUICK_START.md)
3. Use [Setup Checklist](SETUP_CHECKLIST.md) to verify

#### Fix a Problem
1. Check [Troubleshooting Guide](TROUBLESHOOTING.md)
2. Search [GitHub Issues](https://github.com/YOUR_USERNAME/carbonledger/issues)
3. Ask in [Discussions](https://github.com/YOUR_USERNAME/carbonledger/discussions)

#### Deploy to Testnet
1. Read [Testnet Guide](TESTNET_GUIDE.md)
2. Follow deployment steps
3. Test contract interactions

#### Understand Architecture
1. Read [ADR Index](adr/README.md)
2. Review specific decisions
3. Check [Main README](../README.md#-architecture)

#### Deploy to Production
1. Read [Deployment Guide](deployment.md)
2. Review security checklist
3. Follow deployment steps

---

## 📋 Documentation Standards

### File Naming

- Use `SCREAMING_SNAKE_CASE.md` for guides (e.g., `QUICK_START.md`)
- Use `kebab-case.md` for technical docs (e.g., `deployment.md`)
- Use `ADR-NNN-title.md` for architecture decisions

### Structure

All guides should include:
- Clear title and description
- Table of contents (for long docs)
- Step-by-step instructions
- Code examples
- Troubleshooting section
- Links to related docs

### Code Examples

```bash
# Always include comments
command --flag value  # Explain what this does

# Show expected output
# Output: Success message
```

### Cross-References

Link to related documentation:
- Use relative paths: `[Guide](GUIDE.md)`
- Link to specific sections: `[Section](GUIDE.md#section)`
- Reference external docs: `[Stellar Docs](https://developers.stellar.org)`

---

## 🔄 Documentation Workflow

### Adding New Documentation

1. **Create the document:**
   ```bash
   touch docs/NEW_GUIDE.md
   ```

2. **Follow the template:**
   - Title and description
   - Table of contents
   - Main content
   - Examples
   - Troubleshooting
   - Related links

3. **Update this index:**
   - Add to appropriate section
   - Include description
   - Specify audience

4. **Link from other docs:**
   - Update [Main README](../README.md)
   - Update [Contributing Guide](../CONTRIBUTING.md)
   - Cross-reference related docs

### Updating Documentation

1. **Keep it current:**
   - Update when code changes
   - Verify commands still work
   - Check links aren't broken

2. **Test instructions:**
   - Follow your own guide
   - Verify on clean machine
   - Test on multiple platforms

3. **Get feedback:**
   - Ask for reviews
   - Watch for issues
   - Update based on questions

---

## 🎓 Learning Path

### For New Contributors

1. **Week 1: Setup**
   - [ ] Read [New Contributor Guide](NEW_CONTRIBUTOR_GUIDE.md)
   - [ ] Complete [Quick Start](QUICK_START.md)
   - [ ] Run all tests successfully
   - [ ] Deploy to testnet

2. **Week 2: Understanding**
   - [ ] Read [Architecture Decisions](adr/)
   - [ ] Review smart contract code
   - [ ] Understand backend API
   - [ ] Explore frontend components

3. **Week 3: Contributing**
   - [ ] Pick a good first issue
   - [ ] Make your first PR
   - [ ] Get code reviewed
   - [ ] Iterate and merge

### For Experienced Developers

1. **Day 1: Setup**
   - [ ] Quick setup (15-20 min)
   - [ ] Review architecture
   - [ ] Deploy to testnet

2. **Day 2: Deep Dive**
   - [ ] Read relevant ADRs
   - [ ] Review contract code
   - [ ] Test key features

3. **Day 3: Contribute**
   - [ ] Pick an issue
   - [ ] Submit PR
   - [ ] Engage with community

---

## 📊 Documentation Coverage

### Guides Available

- ✅ New contributor onboarding
- ✅ Quick start (< 30 min)
- ✅ Detailed setup guide
- ✅ Troubleshooting reference
- ✅ Testnet setup
- ✅ Architecture decisions
- ✅ API documentation
- ✅ Deployment guide

### Guides Needed

- ⏳ Security best practices
- ⏳ Performance optimization
- ⏳ Monitoring and observability
- ⏳ Backup and recovery
- ⏳ Upgrade procedures
- ⏳ Integration testing guide

**Want to help?** Pick a missing guide and create it!

---

## 🤝 Contributing to Documentation

Documentation contributions are highly valued!

### What to Contribute

- Fix typos and grammar
- Add missing steps
- Improve clarity
- Add examples
- Update outdated info
- Create new guides

### How to Contribute

1. **Edit directly:**
   ```bash
   git checkout -b docs/improve-quick-start
   # Edit docs/QUICK_START.md
   git commit -m "docs: clarify database setup steps"
   git push origin docs/improve-quick-start
   ```

2. **Follow style guide:**
   - Use clear, concise language
   - Include code examples
   - Add troubleshooting tips
   - Link to related docs

3. **Test your changes:**
   - Follow your own instructions
   - Verify on clean machine
   - Check all links work

---

## 🔍 Finding Information

### Search Tips

1. **Use GitHub search:**
   - Search across all docs
   - Filter by file type
   - Search in code

2. **Check the index:**
   - This README
   - [Main README](../README.md)
   - [Contributing Guide](../CONTRIBUTING.md)

3. **Browse by topic:**
   - Setup: Quick Start, Contributing
   - Issues: Troubleshooting
   - Architecture: ADRs
   - Deployment: Deployment Guide

### Still Can't Find It?

1. Search [GitHub Issues](https://github.com/YOUR_USERNAME/carbonledger/issues)
2. Ask in [Discussions](https://github.com/YOUR_USERNAME/carbonledger/discussions)
3. Check [Stellar Docs](https://developers.stellar.org)

---

## 📝 Documentation Checklist

Before submitting documentation:

- [ ] Spell-checked and grammar-checked
- [ ] Code examples tested
- [ ] Links verified
- [ ] Screenshots current (if any)
- [ ] Cross-references added
- [ ] Index updated
- [ ] Follows style guide
- [ ] Tested on clean machine

---

## 🎯 Documentation Goals

### Objectives

1. **Onboard new contributors in < 30 minutes**
2. **Reduce setup issues by 80%**
3. **Answer common questions proactively**
4. **Make architecture decisions transparent**
5. **Enable self-service troubleshooting**

### Metrics

- Time to first successful test run
- Number of setup-related issues
- Documentation feedback scores
- Contributor retention rate

---

## 🙏 Thank You

Thank you for reading and contributing to our documentation! Clear docs make the project accessible to everyone.

**Questions?** Ask in [Discussions](https://github.com/YOUR_USERNAME/carbonledger/discussions)

**Found an issue?** [Report it](https://github.com/YOUR_USERNAME/carbonledger/issues/new)

**Want to help?** Pick a doc to improve and submit a PR!

---

**Last Updated:** 2024  
**Maintained By:** CarbonLedger Contributors
