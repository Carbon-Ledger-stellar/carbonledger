resource "aws_lb" "api" {
    name               = "${var.identifier}-api"
    internal           = var.internal
    load_balancer_type = "application"
    security_groups    = [aws_security_group.api.id]
    subnets            = var.public_subnet_ids

    enable_deletion_protection = var.enable_deletion_protection
    enable_http2              = true

    tags = var.tags
}

resource "aws_lb_target_group" "api" {
    name        = "${var.identifier}-api-tg"
    port        = 3000
    protocol    = "HTTP"
    vpc_id      = var.vpc_id
    target_type = "ip"

    health_check {
        enabled             = true
        healthy_threshold   = 2
        unhealthy_threshold = 10
        timeout             = 5
        interval            = 30
        path                = "/health"
        port                = 3000
        protocol            = "HTTP"
    }

    tags = var.tags
}

resource "aws_lb_listener" "http" {
    load_balancer_arn = aws_lb.api.arn
    port              = 80
    protocol          = "HTTP"

    default_action {
        type = "redirect"
        redirect {
            port        = "443"
            protocol    = "HTTPS"
            status_code = "HTTP_301"
        }
    }
}

resource "aws_lb_listener" "https" {
    load_balancer_arn = aws_lb.api.arn
    port              = 443
    protocol          = "HTTPS"
    ssl_policy        = "ELBSecurityPolicy-2016-08"
    certificate_arn   = var.certificate_arn

    default_action {
        type             = "forward"
        target_group_arn = aws_lb_target_group.api.arn
    }
}

resource "aws_security_group" "api" {
    name        = "${var.identifier}-api-sg"
    description = "Security group for API load balancer"
    vpc_id      = var.vpc_id

    ingress {
        description = "HTTP"
        from_port   = 80
        to_port     = 80
        protocol    = "tcp"
        cidr_blocks = ["0.0.0.0/0"]
    }

    ingress {
        description = "HTTPS"
        from_port   = 443
        to_port     = 443
        protocol    = "tcp"
        cidr_blocks = ["0.0.0.0/0"]
    }

    egress {
        from_port   = 0
        to_port     = 0
        protocol    = "-1"
        cidr_blocks = ["0.0.0.0/0"]
    }

    tags = var.tags
}
