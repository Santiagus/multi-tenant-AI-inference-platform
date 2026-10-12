terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

variable "cluster_name" {
  description = "Name of the Amazon EKS cluster"
  type        = string
}

variable "cluster_version" {
  description = "Kubernetes control-plane version for Amazon EKS"
  type        = string
  default     = "1.30"
}

variable "environment" {
  description = "Deployment environment name (ephemeral, staging, production)"
  type        = string
}

variable "subnet_ids" {
  description = "Private VPC subnet IDs for the EKS control plane and worker nodes"
  type        = list(string)
}

variable "cpu_min_nodes" {
  description = "Minimum replica count for the general CPU system node group"
  type        = number
  default     = 1
}

variable "cpu_max_nodes" {
  description = "Maximum replica count for the general CPU system node group"
  type        = number
  default     = 3
}

variable "enable_gpu_node_group" {
  description = "Whether to register the scale-to-zero GPU worker node group"
  type        = bool
  default     = false
}

variable "gpu_min_nodes" {
  description = "Minimum GPU worker nodes (MUST remain 0 to avoid idle GPU spend)"
  type        = number
  default     = 0
}

variable "gpu_max_nodes" {
  description = "Hard upper bound on GPU worker nodes to cap burst cost"
  type        = number
  default     = 2
}

variable "gpu_capacity_type" {
  description = "EC2 capacity type for GPU worker nodes (SPOT or ON_DEMAND)"
  type        = string
  default     = "SPOT"
}

variable "tags" {
  description = "Common cost-allocation and governance tags"
  type        = map(string)
  default     = {}
}

resource "aws_iam_role" "eks_cluster" {
  name = "${var.cluster_name}-control-plane-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EksControlPlaneTrust"
        Effect = "Allow"
        Principal = {
          Service = "eks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = merge(var.tags, {
    Name        = "${var.cluster_name}-control-plane-role"
    Environment = var.environment
    Component   = "eks-control-plane"
  })
}

resource "aws_eks_cluster" "main" {
  name     = var.cluster_name
  version  = var.cluster_version
  role_arn = aws_iam_role.eks_cluster.arn

  vpc_config {
    subnet_ids              = var.subnet_ids
    endpoint_private_access = true
    endpoint_public_access  = var.environment == "ephemeral"
  }

  enabled_cluster_log_types = ["api", "audit", "authenticator"]

  tags = merge(var.tags, {
    Name        = var.cluster_name
    Environment = var.environment
    Component   = "eks-cluster"
  })
}

resource "aws_iam_role" "eks_nodes" {
  name = "${var.cluster_name}-node-group-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "Ec2WorkerNodeTrust"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = merge(var.tags, {
    Name        = "${var.cluster_name}-node-group-role"
    Environment = var.environment
    Component   = "eks-nodes"
  })
}

resource "aws_eks_node_group" "cpu_system" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "${var.cluster_name}-cpu-system"
  node_role_arn   = aws_iam_role.eks_nodes.arn
  subnet_ids      = var.subnet_ids
  capacity_type   = var.environment == "production" ? "ON_DEMAND" : "SPOT"
  instance_types  = ["t3.large", "t3a.large"]

  scaling_config {
    desired_size = var.cpu_min_nodes
    min_size     = var.cpu_min_nodes
    max_size     = var.cpu_max_nodes
  }

  labels = {
    "platform.ai/node-role" = "cpu-general"
  }

  tags = merge(var.tags, {
    Name        = "${var.cluster_name}-cpu-system"
    Environment = var.environment
    Component   = "eks-node-group-cpu"
  })
}

resource "aws_eks_node_group" "gpu_workers" {
  count           = var.enable_gpu_node_group ? 1 : 0
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "${var.cluster_name}-gpu-workers"
  node_role_arn   = aws_iam_role.eks_nodes.arn
  subnet_ids      = var.subnet_ids
  capacity_type   = var.gpu_capacity_type
  instance_types  = ["g5.xlarge", "g6.xlarge"]

  scaling_config {
    desired_size = 0
    min_size     = var.gpu_min_nodes
    max_size     = var.gpu_max_nodes
  }

  labels = {
    "platform.ai/node-role" = "gpu-worker"
    "nvidia.com/gpu"        = "true"
  }

  taint {
    key    = "nvidia.com/gpu"
    value  = "present"
    effect = "NO_SCHEDULE"
  }

  tags = merge(var.tags, {
    Name        = "${var.cluster_name}-gpu-workers"
    Environment = var.environment
    Component   = "eks-node-group-gpu"
  })
}

output "cluster_name" {
  description = "Name of the provisioned EKS cluster"
  value       = aws_eks_cluster.main.name
}

output "cluster_endpoint" {
  description = "API server endpoint of the EKS cluster"
  value       = aws_eks_cluster.main.endpoint
}

output "gpu_node_group_min_size" {
  description = "Minimum replica count of the GPU node group (0 enforces scale-to-zero)"
  value       = var.gpu_min_nodes
}
